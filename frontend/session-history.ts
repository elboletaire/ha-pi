import type { Message as SessionMessage, UserMessage, AssistantMessage, ToolResultMessage, TextContent, ImageContent, ThinkingContent, ToolCall } from "@mariozechner/pi-ai";

export type SessionHistoryOp =
  | { type: "user"; text: string }
  | { type: "assistant_start" }
  | { type: "assistant_text"; text: string }
  | { type: "assistant_thinking"; text: string }
  | { type: "assistant_tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "assistant_end" }
  | { type: "tool_result"; id: string; name: string; output: string; isError: boolean };

export function buildSessionHistoryOps(messages: SessionMessage[]): SessionHistoryOp[] {
  const ops: SessionHistoryOp[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      ops.push({ type: "user", text: contentToDisplayText(message.content) });
      continue;
    }

    if (message.role === "assistant") {
      ops.push({ type: "assistant_start" });
      for (const block of message.content) {
        if (block.type === "text") {
          if (block.text) ops.push({ type: "assistant_text", text: block.text });
          continue;
        }
        if (block.type === "thinking") {
          if (block.thinking) ops.push({ type: "assistant_thinking", text: block.thinking });
          continue;
        }
        ops.push({
          type: "assistant_tool_call",
          id: block.id,
          name: block.name,
          args: block.arguments ?? {},
        });
      }
      ops.push({ type: "assistant_end" });
      continue;
    }

    ops.push({
      type: "tool_result",
      id: message.toolCallId,
      name: message.toolName,
      output: contentToDisplayText(message.content),
      isError: message.isError,
    });
  }

  return ops;
}

function contentToDisplayText(content: string | (TextContent | ImageContent)[]): string {
  if (typeof content === "string") return content;
  const parts = content.map((block) => {
    if (block.type === "text") return block.text;
    return `[image:${block.mimeType}]`;
  });
  return parts.join("").trim();
}
