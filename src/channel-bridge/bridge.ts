/**
 * ChannelBridge — Provider-agnostic bridge between chat adapters and the pi SDK.
 *
 * Handles:
 * - Per-sender AgentManager lifecycle
 * - FIFO message queue per sender
 * - Concurrent message processing
 * - Command routing (/new, /sessions, etc.)
 * - Session storage shared with web UI
 */

import type {
  ChannelAdapter,
  IncomingMessage,
  IncomingAttachment,
  SenderSession,
  QueuedPrompt,
  CommandResult,
  InlineKeyboardMarkup,
} from "./types.js";
import { AgentManager } from "../agent-manager.js";
import { processCommand } from "./commands.js";
import { log, PATHS } from "../options.js";
import { startTypingLoop } from "./typing.js";
import { AuthStorage } from "@mariozechner/pi-coding-agent";
import type { ResourceLoader } from "@mariozechner/pi-coding-agent";
import { createResourceLoader } from "../resource-loader.js";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";

/**
 * Create a unique sender ID for a chat/user.
 * For Telegram: chat ID (e.g., "-1001234567890" for groups, "123456789" for users)
 */
function getSenderId(adapter: string, sender: string): string {
  return `${adapter}:${sender}`;
}

/**
 * Encode sender ID to a safe filename.
 */
function encodeSenderId(senderId: string): string {
  return senderId.replace(/[:/]/g, "_");
}

/**
 * Decode sender ID from filename.
 */
function decodeSenderId(filename: string): string {
  return filename.replace(/_/g, ":");
}

export class ChannelBridge {
  private adapters: Map<string, ChannelAdapter> = new Map();
  private agentManagers: Map<string, AgentManager> = new Map();
  private senderSessions: Map<string, SenderSession> = new Map();
  private draftCounter = 0;
  private running = false;
  private maxConcurrent: number;
  private processingCount = 0;
  private provider: string;
  private modelId: string;
  private resourceLoader: ResourceLoader;
  private authStorage: AuthStorage;
  private typingIndicators: boolean;
  private abortControllers: Map<string, AbortController> = new Map();
  private activeDrafts: Map<string, { draftId: number; text: string }> = new Map();

  constructor(config: {
    provider: string;
    modelId: string;
    resourceLoader: ResourceLoader;
    authStorage: AuthStorage;
    maxConcurrent?: number;
    typingIndicators?: boolean;
  }) {
    this.provider = config.provider;
    this.modelId = config.modelId;
    this.resourceLoader = config.resourceLoader;
    this.authStorage = config.authStorage;
    this.maxConcurrent = config.maxConcurrent ?? 2;
    this.typingIndicators = config.typingIndicators ?? true;
  }

  /**
   * Register a channel adapter.
   */
  registerAdapter(adapter: ChannelAdapter): void {
    const name = adapter.direction; // Simplified: use direction as name for now
    this.adapters.set(name, adapter);
    log.info(`Registered adapter: ${name} (${adapter.direction})`);
  }

  /**
   * Start all registered adapters.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    for (const [name, adapter] of this.adapters) {
      try {
        if (adapter.start) {
          await adapter.start((msg) => this.handleIncomingMessage(msg));
          log.info(`Started adapter: ${name}`);
        }
      } catch (err: any) {
        log.error(`Failed to start adapter ${name}:`, err.message);
      }
    }
  }

  /**
   * Stop all registered adapters.
   */
  async stop(): Promise<void> {
    this.running = false;

    for (const [name, adapter] of this.adapters) {
      try {
        if (adapter.stop) {
          await adapter.stop();
          log.info(`Stopped adapter: ${name}`);
        }
      } catch (err: any) {
        log.error(`Failed to stop adapter ${name}:`, err.message);
      }
    }
  }

  /**
   * Handle an incoming message from any adapter.
   */
  private async handleIncomingMessage(msg: IncomingMessage): Promise<void> {
    const senderId = getSenderId(msg.adapter, msg.sender);
    const session = this.getOrCreateSession(msg.adapter, msg.sender);

    // Parse if it's a command
    const agentManager = await this.getAgentManager(senderId);
    const command = await processCommand(agentManager, msg.text);

    if (command) {
        // Send the command response
      if (this.typingIndicators) {
        await this.sendTyping(msg.adapter, msg.sender);
      }

      await this.sendMessage(
        {
          adapter: msg.adapter,
          recipient: msg.sender,
          text: command.text,
          source: "telegram:commands",
        },
        command.markup as InlineKeyboardMarkup | undefined
      );

      return;
    }

    // Queue the message for processing
    const queued: QueuedPrompt = {
      id: crypto.randomUUID(),
      adapter: msg.adapter,
      sender: msg.sender,
      text: msg.text,
      attachments: msg.attachments,
      metadata: msg.metadata,
      enqueuedAt: Date.now(),
    };

    session.queue.push(queued);

    // Process if we have capacity
    if (this.processingCount < this.maxConcurrent) {
      this.processQueue(senderId);
    }
  }

  /**
   * Process the message queue for a sender.
   */
  private async processQueue(senderId: string): Promise<void> {
    if (this.processingCount >= this.maxConcurrent) {
      return;
    }

    const session = this.senderSessions.get(senderId);
    if (!session || session.processing || session.queue.length === 0) {
      return;
    }

    session.processing = true;
    this.processingCount++;

    try {
      const prompt = session.queue.shift()!;
      
      const agentManager = await this.getAgentManager(senderId);
      
      // Start typing indicators
      let stopTyping: (() => void) | null = null;
      if (this.typingIndicators) {
        const channelAdapter = this.adapters.get("bidirectional");
        if (channelAdapter?.sendTyping) {
          const { stop } = startTypingLoop({
            adapter: channelAdapter,
            recipient: prompt.sender,
            intervalMs: 4000,
            maxRefreshes: 30, // Allow up to 2 minutes of typing
          });
          stopTyping = stop;
        }
      }

      // Start draft streaming if supported
      const draftId = this.startDraftStreaming(senderId);

      // Execute the prompt
      await agentManager.prompt(prompt.text);

      // Get the response from the session
      const messages = agentManager.getMessages();
      const assistantMessage = messages.findLast(
        (m) => m.role === "assistant" || m.role === "ai"
      );

      const responseText = assistantMessage?.content || "No response generated.";

      // Stop typing indicators
      if (stopTyping) {
        stopTyping();
      }

      // Send the response - use draft if available, otherwise single message
      if (draftId !== null && this.activeDrafts.has(senderId)) {
        // Draft streaming is active, finalize it
        await this.finalizeDraft(
          senderId,
          prompt.adapter,
          prompt.sender
        );
      } else {
        // Send as single message
        await this.sendMessage(
          {
            adapter: prompt.adapter,
            recipient: prompt.sender,
            text: responseText,
            source: "agent",
          },
          undefined
        );
      }

      // Clear abort controller after completion
      const controller = this.abortControllers.get(senderId);
      if (controller) {
        controller.abort();
        this.abortControllers.delete(senderId);
      }
    } catch (err: any) {
      log.error(`Error processing message for ${senderId}:`, err.message);
      
      // Send error message back to user
      await this.sendMessage({
        adapter: "telegram",
        recipient: session?.sender || "unknown",
        text: `❌ Error: ${err.message}`,
        source: "telegram:error",
      });
    } finally {
      session.processing = false;
      this.processingCount--;
      
      // Process next queued message if available
      if (session.queue.length > 0) {
        this.processQueue(senderId);
      }
    }
  }

  /**
   * Get or create an AgentManager for a sender.
   */
  private async getAgentManager(senderId: string): Promise<AgentManager> {
    if (this.agentManagers.has(senderId)) {
      return this.agentManagers.get(senderId)!;
    }

    const agentManager = new AgentManager(
      this.provider,
      this.modelId,
      this.resourceLoader,
      this.authStorage
    );
    
    // Subscribe to agent events for streaming responses
    const unsubscribe = agentManager.subscribe((event) => {
      this.handleAgentEvent(senderId, event);
    });

    // Initialize the agent manager
    try {
      await agentManager.init();
    } catch (err: any) {
      log.error(`Failed to initialize AgentManager for ${senderId}:`, err.message);
      throw err;
    }

    this.agentManagers.set(senderId, agentManager);
    this.unsubscribeFunctions.set(senderId, unsubscribe);

    return agentManager;
  }

  /**
   * Get or create a session record for a sender.
   */
  private getOrCreateSession(adapter: string, sender: string): SenderSession {
    const senderId = getSenderId(adapter, sender);
    
    if (this.senderSessions.has(senderId)) {
      return this.senderSessions.get(senderId)!;
    }

    const session: SenderSession = {
      adapter,
      sender,
      displayName: sender,
      queue: [],
      processing: false,
      abortController: null,
      messageCount: 0,
      startedAt: Date.now(),
    };

    this.senderSessions.set(senderId, session);
    return session;
  }

  /**
   * Store an unsubscribe function for a sender (separate map, not part of SenderSession).
   */
  private unsubscribeFunctions: Map<string, () => void> = new Map();

  /**
   * Handle agent session events (streaming tokens).
   */
  private async handleAgentEvent(senderId: string, event: AgentSessionEvent): Promise<void> {
    const session = this.senderSessions.get(senderId);
    if (!session) return;

    const senderIdParts = senderId.split(":");
    const adapter = senderIdParts[0];
    const sender = senderIdParts.slice(1).join(":");

    // Log event type for debugging
    log.debug(`Agent event for ${senderId}: ${event.type}`);

    // Track message completion
    if (event.type === "message_end" || event.type === "turn_end") {
      session.messageCount++;
      this.activeDrafts.delete(senderId);
    }
  }

  /**
   * Send a message to a recipient.
   */
  private async sendMessage(
    message: { adapter: string; recipient: string; text: string; source?: string },
    markup?: InlineKeyboardMarkup
  ): Promise<void> {
    const adapter = this.adapters.get("bidirectional");
    if (!adapter || !adapter.send) {
      log.error("No outgoing adapter available");
      return;
    }

    await adapter.send({
      adapter: message.adapter,
      recipient: message.recipient,
      text: message.text,
      source: message.source,
      markup: markup,
    });
  }

  /**
   * Send a typing indicator to a recipient.
   */
  private async sendTyping(adapter: string, recipient: string): Promise<void> {
    const channelAdapter = this.adapters.get("bidirectional");
    if (!channelAdapter || !channelAdapter.sendTyping) {
      return;
    }

    await channelAdapter.sendTyping(recipient);
  }

  /**
   * Send a draft update for streaming text.
   * Uses Telegram Bot API 9.3+ sendMessageDraft if available.
   */
  private async sendDraft(
    adapter: string,
    recipient: string,
    draftId: number,
    text: string
  ): Promise<void> {
    const channelAdapter = this.adapters.get("bidirectional");
    if (!channelAdapter || !channelAdapter.sendDraft) {
      // Draft streaming not supported, will fallback to single message
      return;
    }

    try {
      await channelAdapter.sendDraft(recipient, draftId, text);
    } catch (err: any) {
      log.debug(`Failed to send draft: ${err.message}`);
      // Silently ignore - draft streaming is optional
    }
  }

  /**
   * Start draft streaming for a sender.
   * Returns the draft ID if supported, null otherwise.
   */
  private startDraftStreaming(senderId: string): number | null {
    const channelAdapter = this.adapters.get("bidirectional");
    if (!channelAdapter || !channelAdapter.sendDraft) {
      return null;
    }

    const draftId = ++this.draftCounter;
    this.activeDrafts.set(senderId, { draftId, text: "" });
    return draftId;
  }

  /**
   * Update draft with new text.
   */
  private async updateDraft(
    senderId: string,
    adapter: string,
    recipient: string,
    newText: string
  ): Promise<void> {
    const active = this.activeDrafts.get(senderId);
    if (!active) return;

    const fullText = active.text + newText;
    active.text = fullText;

    await this.sendDraft(adapter, recipient, active.draftId, fullText);
  }

  /**
   * Finalize draft and send complete message.
   */
  private async finalizeDraft(
    senderId: string,
    adapter: string,
    recipient: string,
    markup?: InlineKeyboardMarkup
  ): Promise<void> {
    const active = this.activeDrafts.get(senderId);
    if (!active) return;

    await this.sendMessage(
      {
        adapter,
        recipient,
        text: active.text,
        source: "agent",
      },
      markup
    );

    this.activeDrafts.delete(senderId);
  }

  /**
   * Abort current generation for a sender.
   */
  async abort(senderId: string): Promise<void> {
    const agentManager = this.agentManagers.get(senderId);
    if (agentManager) {
      await agentManager.abort();
    }

    const abortController = this.abortControllers.get(senderId);
    if (abortController) {
      abortController.abort();
      this.abortControllers.delete(senderId);
    }
  }

  /**
   * Get current state of all sessions.
   */
  getStates(): Map<string, any> {
    const states = new Map<string, any>();
    
    for (const [senderId, agentManager] of this.agentManagers) {
      const state = agentManager.getState();
      if (state) {
        states.set(senderId, state);
      }
    }
    
    return states;
  }
}
