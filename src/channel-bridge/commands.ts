/**
 * Telegram bot command handlers.
 *
 * Handles /new, /sessions, /session, /status, /abort, /model commands.
 * Commands are processed before reaching the AgentManager.
 */

import type {
  CommandResult,
  TelegramMarkup,
  InlineKeyboardMarkup,
  InlineKeyboardButton,
} from "./types.js";
import { AgentManager } from "../agent-manager.js";
import { log } from "../options.js";
import type { SessionInfo } from "@mariozechner/pi-coding-agent";

/**
 * Build a reply keyboard markup for session selection.
 */
function buildSessionKeyboard(sessions: SessionInfo[], chatId: string): InlineKeyboardMarkup | undefined {
  if (sessions.length === 0) return undefined;

  const rows: InlineKeyboardButton[][] = [];
  
  // Group sessions into rows of 2
  for (let i = 0; i < sessions.length; i += 2) {
    const row: InlineKeyboardButton[] = [];
    
    if (i < sessions.length) {
      const session = sessions[i];
      const displayName = session.name || session.id.slice(0, 8);
      row.push({
        text: displayName,
        callback_data: `session:${chatId}:${session.path}`,
      });
    }
    
    if (i + 1 < sessions.length) {
      const session = sessions[i + 1];
      const displayName = session.name || session.id.slice(0, 8);
      row.push({
        text: displayName,
        callback_data: `session:${chatId}:${session.path}`,
      });
    }
    
    rows.push(row);
  }

  // Add "back to chat" button
  rows.push([
    {
      text: "← Back to chat",
      callback_data: "back_to_chat",
    },
  ]);

  return { inline_keyboard: rows };
}

/**
 * Build a clean text list of sessions.
 */
function buildSessionListText(sessions: SessionInfo[]): string {
  if (sessions.length === 0) {
    return "No sessions found.";
  }

  const lines: string[] = [`Available sessions:\n\nID\tName\t\t\t\tMsgs\tLast Modified`];

  for (const session of sessions) {
    const id = session.id.slice(0, 8);
    const name = (session.name || session.id.slice(0, 10)).padEnd(20, " ");
    const msgs = session.messageCount.toString().padStart(4, " ");
    const last = session.modified.toLocaleString();

    lines.push(`${id}\t${name}\t${msgs}\t${last}`);
  }

  lines.push(
    "",
    "Commands:",
    "  `/sessions` - list all sessions",
    "  `/session <ID>` - switch to a session",
    "  `/new` - create a new session",
    "  `/delete <ID>` - delete a session",
  );

  return lines.join("\n");
}

/**
 * Handle /new command - create a new session.
 */
export async function handleNewCommand(agentManager: AgentManager): Promise<CommandResult> {
  try {
    await agentManager.newSession();
    const state = agentManager.getState();
    
    return {
      text: `✅ New session created.\n\nID: ${state?.sessionId.slice(0, 8)}\nModel: ${state?.model}`,
      markup: {
        inline_keyboard: [
          [{ text: "🔄 Start chatting", callback_data: "continue_chat" }],
        ],
      },
    };
  } catch (err: any) {
    log.error("Failed to create new session:", err.message);
    return {
      text: `❌ Failed to create session: ${err.message}`,
    };
  }
}

/**
 * Handle /sessions command - list all sessions.
 */
export async function handleSessionsCommand(agentManager: AgentManager): Promise<CommandResult> {
  try {
    const sessions = await agentManager.listSessions();
    return {
      text: buildSessionListText(sessions),
    };
  } catch (err: any) {
    log.error("Failed to list sessions:", err.message);
    return {
      text: `❌ Failed to list sessions: ${err.message}`,
    };
  }
}

/**
 * Handle /session <ID> command - switch to a specific session.
 */
export async function handleSessionCommand(
  agentManager: AgentManager,
  sessionPath: string
): Promise<CommandResult> {
  try {
    const sessions = await agentManager.listSessions();
    const session = sessions.find((s) => s.path === sessionPath);

    if (!session) {
      return {
        text: `❌ Session not found: ${sessionPath}\n\nAvailable sessions:\n${buildSessionListText(sessions)}`,
      };
    }

    await agentManager.switchSession(sessionPath);
    const state = agentManager.getState();

    return {
      text: `✅ Switched to session.\n\nID: ${session.id.slice(0, 8)}\nModel: ${state?.model}\nMessages: ${state?.messageCount}`,
      markup: buildSessionKeyboard(sessions, "current"),
    };
  } catch (err: any) {
    log.error("Failed to switch session:", err.message);
    return {
      text: `❌ Failed to switch session: ${err.message}`,
    };
  }
}

/**
 * Handle /delete <ID> command - delete a session.
 */
export async function handleDeleteCommand(
  agentManager: AgentManager,
  sessionPath: string
): Promise<CommandResult> {
  try {
    const sessions = await agentManager.listSessions();
    const session = sessions.find((s) => s.path === sessionPath);

    if (!session) {
      return {
        text: `❌ Session not found: ${sessionPath}`,
      };
    }

    await agentManager.deleteSession(sessionPath);
    
    return {
      text: `✅ Session deleted: ${session.id.slice(0, 8)}`,
      markup: {
        inline_keyboard: [
          [{ text: "🔄 List sessions", callback_data: "list_sessions" }],
        ],
      },
    };
  } catch (err: any) {
    log.error("Failed to delete session:", err.message);
    return {
      text: `❌ Failed to delete session: ${err.message}`,
    };
  }
}

/**
 * Handle /status command - show current session status.
 */
export async function handleStatusCommand(agentManager: AgentManager): Promise<CommandResult> {
  try {
    const state = agentManager.getState();

    if (!state) {
      return {
        text: "⚠️ No session active.",
      };
    }

    return {
      text: `📊 Session Status\n\nSession ID: ${state.sessionId.slice(0, 8)}\nModel: ${state.model}\nMessages: ${state.messageCount}\nStreaming: ${state.isStreaming}\nThinking Level: ${state.thinkingLevel}`,
    };
  } catch (err: any) {
    log.error("Failed to get status:", err.message);
    return {
      text: `❌ Failed to get status: ${err.message}`,
    };
  }
}

/**
 * Handle /model [name] command - show or change model.
 */
export async function handleModelCommand(
  agentManager: AgentManager,
  newModel?: string
): Promise<CommandResult> {
  try {
    if (newModel) {
      // Parse model name (provider/model or just model)
      const parts = newModel.split("/");
      let provider: string;
      let modelId: string;

      if (parts.length === 2) {
        provider = parts[0];
        modelId = parts[1];
      } else {
        // Assume current provider
        const state = agentManager.getState();
        if (!state || !state.model) {
          return {
            text: `❌ No model configured. Use format: \`/model provider/modelId\``,
          };
        }
        const current = state.model.split("/");
        provider = current[0];
        modelId = parts[0];
      }

      await agentManager.setModel(provider, modelId);
      const state = agentManager.getState();

      return {
        text: `✅ Model changed to: ${state?.model}`,
        markup: {
          inline_keyboard: [
            [{ text: "🔄 List available models", callback_data: "list_models" }],
          ],
        },
      };
    } else {
      // Show current model
      const state = agentManager.getState();
      const availableModels = agentManager.getAvailableModels();

      const currentModel = state?.model || "not set";
      const modelList = availableModels
        .map((m) => `  • ${m.provider}/${m.id}`)
        .join("\n");

      return {
        text: `📊 Current model: ${currentModel}\n\nAvailable models:\n${modelList}`,
      };
    }
  } catch (err: any) {
    log.error("Failed to handle model command:", err.message);
    return {
      text: `❌ ${err.message}`,
    };
  }
}

/**
 * Handle /abort command - cancel current generation.
 */
export async function handleAbortCommand(agentManager: AgentManager): Promise<CommandResult> {
  try {
    await agentManager.abort();
    return {
      text: "✅ Generation aborted.",
      markup: {
        inline_keyboard: [
          [{ text: "🔄 Continue chatting", callback_data: "continue_chat" }],
        ],
      },
    };
  } catch (err: any) {
    log.error("Failed to abort:", err.message);
    return {
      text: `❌ Failed to abort: ${err.message}`,
    };
  }
}

/**
 * Map incoming text commands to handlers.
 * Returns undefined if the command doesn't match any handler.
 */
export function parseCommand(text: string):
  | { type: "new" }
  | { type: "sessions" }
  | { type: "session"; path: string }
  | { type: "delete"; path: string }
  | { type: "status" }
  | { type: "model"; model?: string }
  | { type: "abort" }
  | undefined {
  const trimmed = text.trim();
  
  if (trimmed === "/new" || trimmed === "/new@pi_agent_bot") {
    return { type: "new" };
  }
  
  if (trimmed === "/sessions" || trimmed === "/sessions@pi_agent_bot") {
    return { type: "sessions" };
  }
  
  if (trimmed.startsWith("/session ") || trimmed.startsWith("/session@pi_agent_bot ")) {
    const parts = trimmed.split(" ");
    const path = parts[1]?.replace("@pi_agent_bot", "") || "";
    return { type: "session", path };
  }
  
  if (trimmed.startsWith("/delete ") || trimmed.startsWith("/delete@pi_agent_bot ")) {
    const parts = trimmed.split(" ");
    const path = parts[1]?.replace("@pi_agent_bot", "") || "";
    return { type: "delete", path };
  }
  
  if (trimmed === "/status" || trimmed === "/status@pi_agent_bot") {
    return { type: "status" };
  }
  
  if (trimmed.startsWith("/model ") || trimmed.startsWith("/model@pi_agent_bot ")) {
    const parts = trimmed.split(" ");
    const model = parts[1]?.replace("@pi_agent_bot", "") || undefined;
    return { type: "model", model };
  }
  
  if (trimmed === "/abort" || trimmed === "/abort@pi_agent_bot") {
    return { type: "abort" };
  }
  
  return undefined;
}

/**
 * Process a command and return the result.
 */
export async function processCommand(
  agentManager: AgentManager,
  text: string
): Promise<CommandResult | null> {
  const command = parseCommand(text);
  
  if (!command) {
    return null;
  }

  switch (command.type) {
    case "new":
      return handleNewCommand(agentManager);
    
    case "sessions":
      return handleSessionsCommand(agentManager);
    
    case "session":
      return handleSessionCommand(agentManager, command.path);
    
    case "delete":
      return handleDeleteCommand(agentManager, command.path);
    
    case "status":
      return handleStatusCommand(agentManager);
    
    case "model":
      return handleModelCommand(agentManager, command.model);
    
    case "abort":
      return handleAbortCommand(agentManager);
    
    default:
      return null;
  }
}
