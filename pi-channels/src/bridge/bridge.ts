/**
 * pi-channels — Chat bridge.
 *
 * Listens for incoming messages (channel:receive), serializes per sender,
 * runs prompts via isolated subprocesses, and sends responses back via
 * the same adapter. Each sender gets their own FIFO queue. Multiple
 * senders run concurrently up to maxConcurrent.
 */

import type {
	IncomingMessage,
	IncomingAttachment,
	QueuedPrompt,
	SenderSession,
	BridgeConfig,
	ModelHealth,
	CommandResult,
} from "../types.ts";
import type { ChannelRegistry } from "../registry.ts";
import type { EventBus } from "@mariozechner/pi-coding-agent";
import { runPrompt } from "./runner.ts";
import { RpcSessionManager, type SessionStatus } from "./rpc-runner.ts";
import { isCommand, handleCommand, parseCommand, isPromptRewrite, extractPrompt, type CommandContext } from "./commands.ts";
import { startTyping } from "./typing.ts";

const BRIDGE_DEFAULTS: Required<BridgeConfig> = {
	enabled: false,
	sessionMode: "persistent",
	sessionRules: [],
	idleTimeoutMinutes: 30,
	maxQueuePerSender: 5,
	timeoutMs: 300_000,
	maxConcurrent: 2,
	model: null,
	typingIndicators: true,
	commands: true,
	streamingDrafts: true,
	streamingIntervalMs: 500,
	extensions: [],
};

type LogFn = (event: string, data: unknown, level?: string) => void;

let idCounter = 0;
function nextId(): string {
	return `msg-${Date.now()}-${++idCounter}`;
}

export class ChatBridge {
	private config: Required<BridgeConfig>;
	private cwd: string;
	private registry: ChannelRegistry;
	private events: EventBus;
	private log: LogFn;
	private sessions = new Map<string, SenderSession>();
	private activeCount = 0;
	private running = false;
	private rpcManager: RpcSessionManager | null = null;
	/** Whether the configured model was validated at startup. */
	private modelValidated = false;
	/** Error message from model validation (null = not yet validated or passed). */
	private modelValidationError: string | null = null;
	/** Last subprocess error (for /status diagnostics). */
	private lastError: string | null = null;

	constructor(
		bridgeConfig: BridgeConfig | undefined,
		cwd: string,
		registry: ChannelRegistry,
		events: EventBus,
		log: LogFn = () => {},
	) {
		this.config = { ...BRIDGE_DEFAULTS, ...bridgeConfig };
		this.cwd = cwd;
		this.registry = registry;
		this.events = events;
		this.log = log;
	}

	// ── Lifecycle ─────────────────────────────────────────────

	start(): void {
		if (this.running) return;
		this.running = true;

		// Always create the RPC manager — it's used on-demand for persistent senders
		this.rpcManager = new RpcSessionManager(
			{
				cwd: this.cwd,
				model: this.getFullModelName(),
				timeoutMs: this.config.timeoutMs,
				extensions: this.config.extensions,
			},
			this.config.idleTimeoutMinutes * 60_000,
		);

		// Validate model asynchronously — don't block startup
		this.validateModel();
	}

	/**
	 * Validate the configured model exists by checking `pi --list-models`.
	 * Zero tokens, sub-second. Logs clearly on failure.
	 */
	private async validateModel(): Promise<void> {
		const model = this.getFullModelName();
		if (!model) {
			this.modelValidated = true; // No model override = use default, probably fine
			return;
		}

		try {
			const slash = model.indexOf("/");
			const provider = slash > 0 ? model.slice(0, slash) : null;
			const modelId = slash > 0 ? model.slice(slash + 1) : model;

			const { spawn } = await import("node:child_process");
			const found = await new Promise<boolean>((resolve) => {
				const child = spawn("pi", ["--no-extensions", "--list-models"], {
					cwd: this.cwd,
					stdio: ["ignore", "pipe", "pipe"],
					timeout: 10_000,
				});
				let stdout = "";
				child.stdout?.on("data", (chunk: any) => { stdout += chunk.toString(); });
				child.on("close", () => {
					// Check if the model appears in the listing
					// Format: "provider       model-id       ..."
					const lines = stdout.split("\n");
					const match = lines.some(line => {
						const parts = line.trim().split(/\s+/);
						if (provider) {
							return parts[0] === provider && parts[1] === modelId;
						}
						return parts[1] === modelId;
					});
					resolve(match);
				});
				child.on("error", () => resolve(false));
			});

			if (found) {
				this.modelValidated = true;
				this.modelValidationError = null;
				this.log("bridge-model-validated", { model }, "INFO");
			} else {
				this.modelValidated = false;
				this.modelValidationError = `Model "${model}" not found in available models`;
				this.log("bridge-model-invalid", {
					model,
					error: this.modelValidationError,
					configValue: this.config.model,
				}, "ERROR");
			}
		} catch (err: any) {
			this.modelValidated = false;
			this.modelValidationError = err.message;
			this.log("bridge-model-invalid", { model, error: err.message }, "ERROR");
		}
	}
	
	/**
	 * Get model name for subprocess.
	 * Normalizes "provider:model" → "provider/model" because pi's CLI
	 * uses "/" as the provider separator (even though its UI displays ":").
	 */
	private getFullModelName(): string | null {
		const m = this.config.model;
		if (!m) return null;
		// "anthropic:claude-opus-4-6" → "anthropic/claude-opus-4-6"
		// Only convert the first colon, and only if it looks like provider:model
		// (not a bare model name that happens to contain a colon for thinking level).
		const colon = m.indexOf(":");
		if (colon > 0 && !m.includes("/")) {
			return m.slice(0, colon) + "/" + m.slice(colon + 1);
		}
		return m;
	}

	stop(): void {
		this.running = false;
		for (const session of this.sessions.values()) {
			session.abortController?.abort();
		}
		this.sessions.clear();
		this.activeCount = 0;
		this.rpcManager?.killAll();
		this.rpcManager = null;
	}

	isActive(): boolean {
		return this.running;
	}

	/** Update model from external settings change. */
	setModel(model: string | null): void {
		this.config.model = model;
		this.rpcManager?.updateModel(this.getFullModelName());
		this.log("bridge-model-change", { model, source: "settings" }, "INFO");
	}

	updateConfig(cfg: BridgeConfig): void {
		this.config = { ...BRIDGE_DEFAULTS, ...cfg };
	}

	// ── Main entry point ──────────────────────────────────────

	async handleMessage(message: IncomingMessage): Promise<void> {
		if (!this.running) return;

		let text = message.text?.trim();
		const hasAttachments = message.attachments && message.attachments.length > 0;
		if (!text && !hasAttachments) return;

		// Rejected messages (too large, unsupported type) — send back directly
		if (message.metadata?.rejected) {
			this.sendRawReply(message.adapter, message.sender, text || "⚠️ Unsupported message.");
			return;
		}

		const senderKey = `${message.adapter}:${message.sender}`;

		// Get or create session
		let session = this.sessions.get(senderKey);
		if (!session) {
			session = this.createSession(message);
			this.sessions.set(senderKey, session);
		}

		// Bot commands (only for text-only messages)
		if (text && !hasAttachments && this.config.commands && isCommand(text)) {
			const reply = await handleCommand(text, session, this.commandContext());
			if (reply !== null) {
				// Unwrap CommandResult
				const replyText = typeof reply === "string" ? reply : reply.text;
				const replyMarkup = typeof reply === "string" ? undefined : (reply as CommandResult).markup;

				// Prompt shortcut — rewrite to agent prompt and continue to queue
				if (isPromptRewrite(replyText)) {
					text = extractPrompt(replyText);
					// Fall through to enqueue below
				} else {
					this.sendRawReply(message.adapter, message.sender, replyText, replyMarkup);
					return;
				}
			} else {
				// Unrecognized command — send error instead of passing to agent
				const { command } = parseCommand(text);
				this.sendRawReply(
					message.adapter,
					message.sender,
					`❌ Unknown command: /${command}\n\nUse /help to see available commands.`,
				);
				return;
			}
		}

		// Queue depth check
		if (session.queue.length >= this.config.maxQueuePerSender) {
			this.sendRawReply(
				message.adapter,
				message.sender,
				`⚠️ Queue full (${this.config.maxQueuePerSender} pending). ` +
				`Wait for current prompts to finish or use /abort.`,
			);
			return;
		}

		// Enqueue
		const queued: QueuedPrompt = {
			id: nextId(),
			adapter: message.adapter,
			sender: message.sender,
			text: text || "Describe this.",
			attachments: message.attachments,
			metadata: message.metadata,
			enqueuedAt: Date.now(),
		};
		session.queue.push(queued);
		session.messageCount++;

		this.events.emit("bridge:enqueue", {
			id: queued.id, adapter: message.adapter, sender: message.sender,
			queueDepth: session.queue.length,
		});

		this.processNext(senderKey);
	}

	// ── Processing ────────────────────────────────────────────

	private async processNext(senderKey: string): Promise<void> {
		const session = this.sessions.get(senderKey);
		if (!session || session.processing || session.queue.length === 0) return;
		if (this.activeCount >= this.config.maxConcurrent) return;

		session.processing = true;
		this.activeCount++;
		const prompt = session.queue.shift()!;

		// Typing indicator
		const adapter = this.registry.getAdapter(prompt.adapter);
		const typing = this.config.typingIndicators
			? startTyping(adapter, prompt.sender)
			: { stop() {} };

		const ac = new AbortController();
		session.abortController = ac;

		const usePersistent = this.shouldUsePersistent(senderKey);

		this.events.emit("bridge:start", {
			id: prompt.id, adapter: prompt.adapter, sender: prompt.sender,
			text: prompt.text.slice(0, 100),
			persistent: usePersistent,
		});

		try {
			let result;

			if (usePersistent && this.rpcManager) {
				// Persistent mode: use RPC session (with optional streaming drafts)
				result = await this.runWithRpc(senderKey, prompt, ac.signal, adapter);
			} else {
				// Stateless mode: spawn subprocess
				result = await runPrompt({
					prompt: prompt.text,
					cwd: this.cwd,
					timeoutMs: this.config.timeoutMs,
					model: this.getFullModelName(),
					signal: ac.signal,
					attachments: prompt.attachments,
					extensions: this.config.extensions,
				});
			}

			typing.stop();

			if (result.ok) {
				// Warn on first reply if model validation explicitly failed (not if still pending)
				let response = result.response;
				if (this.modelValidationError && session.messageCount <= 1) {
					response = `⚠️ <i>Model validation failed at startup: ${this.modelValidationError}</i>\n\n` + response;
				}
				this.sendAgentReply(prompt.adapter, prompt.sender, response);
				this.lastError = null;
			} else if (result.error === "Aborted by user") {
				this.sendRawReply(prompt.adapter, prompt.sender, "⏹ Aborted.");
			} else {
				this.lastError = result.error || `Exit code ${result.exitCode}`;
				const userError = sanitizeError(result.error);
				if (result.response) {
					// Agent produced partial output before failing
					this.sendAgentReply(prompt.adapter, prompt.sender, result.response);
				} else {
					this.sendRawReply(prompt.adapter, prompt.sender, `❌ ${userError}`);
				}
			}

			this.events.emit("bridge:complete", {
				id: prompt.id, adapter: prompt.adapter, sender: prompt.sender,
				ok: result.ok, durationMs: result.durationMs,
				persistent: usePersistent,
			});
			this.log("bridge-complete", {
				id: prompt.id, adapter: prompt.adapter, ok: result.ok,
				durationMs: result.durationMs, persistent: usePersistent,
			}, result.ok ? "INFO" : "WARN");

		} catch (err: any) {
			typing.stop();
			this.log("bridge-error", { adapter: prompt.adapter, sender: prompt.sender, error: err.message }, "ERROR");
			this.sendRawReply(prompt.adapter, prompt.sender, `❌ Unexpected error: ${err.message}`);
		} finally {
			session.abortController = null;
			session.processing = false;
			this.activeCount--;

			if (session.queue.length > 0) this.processNext(senderKey);
			this.drainWaiting();
		}
	}

	/** Run a prompt via persistent RPC session. */
	private async runWithRpc(
		senderKey: string,
		prompt: QueuedPrompt,
		signal?: AbortSignal,
		adapter?: import("../types.ts").ChannelAdapter,
	): Promise<import("../types.ts").RunResult> {
		try {
			const { session: rpcSession, wasRestarted, reason } =
				await this.rpcManager!.getSessionWithStatus(senderKey);

			// Set up streaming draft callback if enabled and adapter supports it
			let onStreaming: ((text: string) => void) | undefined;
			if (
				this.config.streamingDrafts &&
				adapter?.sendDraft
			) {
				const draftId = Math.floor(Math.random() * 2_000_000_000) + 1; // non-zero
				const intervalMs = this.config.streamingIntervalMs;
				let accumulated = "";
				let lastSentAt = 0;
				let pendingTimer: ReturnType<typeof setTimeout> | null = null;

				const sendDraftNow = () => {
					if (!accumulated) return;
					const text = accumulated;
					lastSentAt = Date.now();
					// Fire-and-forget — don't await in streaming path
					adapter.sendDraft!(prompt.sender, draftId, text).catch(() => {});
				};

				onStreaming = (_delta: string) => {
					accumulated += _delta;
					const now = Date.now();
					const elapsed = now - lastSentAt;

					if (elapsed >= intervalMs) {
						// Enough time passed — send immediately
						if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
						sendDraftNow();
					} else if (!pendingTimer) {
						// Schedule a send at the next interval
						pendingTimer = setTimeout(() => {
							pendingTimer = null;
							sendDraftNow();
						}, intervalMs - elapsed);
					}
				};

				// Cleanup pending timer when done (attached to signal abort too)
				const cleanupTimer = () => {
					if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
				};
				signal?.addEventListener("abort", cleanupTimer, { once: true });

				// Attach cleanup so we can call it after runPrompt resolves
				(onStreaming as any).__cleanup = cleanupTimer;
			}

			const result = await rpcSession.runPrompt(prompt.text, {
				signal,
				attachments: prompt.attachments,
				onStreaming,
			});

			// Clean up any pending draft timer
			if (onStreaming && (onStreaming as any).__cleanup) {
				(onStreaming as any).__cleanup();
			}

			// Prepend context-loss warning if session was restarted
			if (wasRestarted && result.ok) {
				const notice = reason === "idle"
					? "⚠️ _Session expired after idle timeout. Previous context lost. Use /new to start fresh intentionally._\n\n"
					: "⚠️ _Previous session ended unexpectedly. Starting fresh context._\n\n";
				return { ...result, response: notice + result.response };
			}

			return result;
		} catch (err: any) {
			return {
				ok: false,
				response: "",
				error: err.message,
				durationMs: 0,
				exitCode: 1,
			};
		}
	}

	/** After a slot frees up, check other senders waiting for concurrency. */
	private drainWaiting(): void {
		if (this.activeCount >= this.config.maxConcurrent) return;
		for (const [key, session] of this.sessions) {
			if (!session.processing && session.queue.length > 0) {
				this.processNext(key);
				if (this.activeCount >= this.config.maxConcurrent) break;
			}
		}
	}

	// ── Session management ────────────────────────────────────

	private createSession(message: IncomingMessage): SenderSession {
		return {
			adapter: message.adapter,
			sender: message.sender,
			displayName:
				(message.metadata?.firstName as string) ||
				(message.metadata?.username as string) ||
				message.sender,
			queue: [],
			processing: false,
			abortController: null,
			messageCount: 0,
			startedAt: Date.now(),
		};
	}

	getStats(): {
		active: boolean;
		sessions: number;
		activePrompts: number;
		totalQueued: number;
	} {
		let totalQueued = 0;
		for (const s of this.sessions.values()) totalQueued += s.queue.length;
		return {
			active: this.running,
			sessions: this.sessions.size,
			activePrompts: this.activeCount,
			totalQueued,
		};
	}

	getSessions(): Map<string, SenderSession> {
		return this.sessions;
	}

	/** Model health info for diagnostics (used by /status command). */
	getModelHealth(): ModelHealth {
		return {
			model: this.config.model || "default",
			validated: this.modelValidated,
			error: this.modelValidationError,
			lastError: this.lastError,
		};
	}

	// ── Session mode resolution ───────────────────────────────

	/**
	 * Determine if a sender should use persistent (RPC) or stateless mode.
	 * Checks sessionRules first (first match wins), falls back to sessionMode default.
	 */
	private shouldUsePersistent(senderKey: string): boolean {
		for (const rule of this.config.sessionRules) {
			if (globMatch(rule.match, senderKey)) {
				return rule.mode === "persistent";
			}
		}
		return this.config.sessionMode === "persistent";
	}

	// ── Command context ───────────────────────────────────────

	private commandContext(): CommandContext {
		return {
			getModelHealth: () => this.getModelHealth(),
			isPersistent: (sender: string) => {
				// Find the sender key to check mode
				for (const [key, session] of this.sessions) {
					if (session.sender === sender) return this.shouldUsePersistent(key);
				}
				return this.config.sessionMode === "persistent";
			},
			abortCurrent: (sender: string): boolean => {
				for (const session of this.sessions.values()) {
					if (session.sender === sender && session.abortController) {
						session.abortController.abort();
						return true;
					}
				}
				return false;
			},
			clearQueue: (sender: string): void => {
				for (const session of this.sessions.values()) {
					if (session.sender === sender) session.queue.length = 0;
				}
			},
			resetSession: (sender: string): void => {
				for (const [key, session] of this.sessions) {
					if (session.sender === sender) {
						// Reset message count but keep the bridge session alive
						// (preserves queue/processing state, avoids race with RPC reset)
						session.messageCount = 0;
						session.startedAt = Date.now();
						// Reset persistent RPC session (clear conversation context)
						if (this.rpcManager) {
							this.rpcManager.resetSession(key).catch((err) => {
								this.log("bridge-reset-error", {
									sender, error: err?.message,
								}, "WARN");
							});
						}
					}
				}
			},
			getModel: (): string => {
				return this.config.model || "default";
			},
			setModel: (model: string): void => {
				this.config.model = model;
				// Also update the RPC manager so new sessions use the new model
				this.rpcManager?.updateModel(this.getFullModelName());
				this.log("bridge-model-change", { model }, "INFO");
			},
			getAvailableModels: (): string[] => {
				// Model listing is not currently available via RPC.
				// Return empty to allow any model name (validated on first use).
				// Future: query pi --list-models dynamically.
				return [];
			},
			restartSessionWithModel: async (sender: string, model: string): Promise<void> => {
				// Find the sender key
				let senderKey: string | null = null;
				for (const [key, session] of this.sessions) {
					if (session.sender === sender) {
						senderKey = key;
						break;
					}
				}
				
				if (!senderKey || !this.rpcManager) return;
				
				// Save context before killing the session
				const session = this.sessions.get(senderKey);
				if (session) {
					// Abort any running request
					session.abortController?.abort();
					// Clear queue to avoid confusion
					session.queue.length = 0;
				}
				
				// Change model in both bridge config and RPC manager
				this.config.model = model;
				this.rpcManager.updateModel(this.getFullModelName());
				
				// Kill the RPC session (context will be saved automatically by idle timeout handler)
				// But we trigger save manually to ensure it happens
				const rpcSession = this.rpcManager['sessions'].get(senderKey);
				if (rpcSession && rpcSession.isAlive()) {
					await this.rpcManager['saveContext'](senderKey, rpcSession);
				}
				
				// Mark as killed due to model change (use "idle" as it will restore context)
				this.rpcManager['killReasons'].set(senderKey, "idle");
				this.rpcManager.killSession(senderKey);
				
				this.log("bridge-model-restart", { sender, model, senderKey }, "INFO");
			},
		};
	}

	// ── Reply ─────────────────────────────────────────────────

	/** Send a raw reply (commands, errors) — no header. */
	private sendRawReply(adapter: string, recipient: string, text: string, markup?: unknown): void {
		this.registry.send({ adapter, recipient, text, markup });
	}

	/** Send an agent reply — with header via source field. */
	private sendAgentReply(adapter: string, recipient: string, text: string): void {
		const modelName = this.config.model || "default";
		const source = `🤖 ${modelName}`;
		this.registry.send({ adapter, recipient, text, source });
	}
}

// ── Helpers ───────────────────────────────────────────────────

/**
 * Simple glob matcher supporting `*` (any chars) and `?` (single char).
 * Used for sessionRules pattern matching against "adapter:senderId" keys.
 */
function globMatch(pattern: string, text: string): boolean {
	// Escape regex special chars except * and ?
	const re = pattern
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*/g, ".*")
		.replace(/\?/g, ".");
	return new RegExp(`^${re}$`).test(text);
}

const MAX_ERROR_LENGTH = 200;

/**
 * Known error patterns → user-friendly messages.
 * Checked in order; first match wins.
 */
const ERROR_PATTERNS: Array<[RegExp, string]> = [
	[/Model .* not found/i, "Model not found. Check bridge model config in settings.json."],
	[/No API key found for "?([^"]*)"?/i, "Missing API key for provider. Run /login on the host."],
	[/Authentication failed/i, "Auth expired. Run /login on the host to re-authenticate."],
	[/Credentials may have expired/i, "Auth expired. Run /login on the host to re-authenticate."],
	[/EADDRINUSE/i, "Port conflict — an extension is trying to bind a port already in use."],
	[/Failed to start RPC/i, "Could not start session subprocess. Check host logs."],
	[/Failed to spawn/i, "Could not spawn pi subprocess. Is pi installed?"],
];

/**
 * Sanitize subprocess error output for end-user display.
 * First tries known patterns for clear messages, then falls back
 * to extracting the most meaningful line from the raw error.
 */
function sanitizeError(error: string | undefined): string {
	if (!error) return "Something went wrong. Please try again.";

	// Try known patterns first — these give actionable messages
	for (const [pattern, message] of ERROR_PATTERNS) {
		if (pattern.test(error)) return message;
	}

	// Fallback: extract the most meaningful line
	const lines = error.split("\n").filter(l => l.trim());
	const meaningful = lines.find(l =>
		!l.startsWith("Extension error") &&
		!l.startsWith("    at ") &&
		!l.startsWith("node:") &&
		!l.includes("NODE_MODULE_VERSION") &&
		!l.includes("compiled against a different") &&
		!l.includes("Emitted 'error' event")
	);

	const msg = meaningful?.trim() || "Something went wrong. Please try again.";

	return msg.length > MAX_ERROR_LENGTH
		? msg.slice(0, MAX_ERROR_LENGTH) + "…"
		: msg;
}
