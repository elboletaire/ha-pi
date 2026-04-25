import { describe, expect, it } from "vitest";
import { buildSessionHistoryOps } from "../frontend/session-history";

describe("buildSessionHistoryOps", () => {
  it("converts session messages into ordered UI operations", () => {
    const ops = buildSessionHistoryOps([
      { role: "user", content: "hello", timestamp: 1 },
      {
        role: "assistant",
        api: "anthropic-messages",
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "toolUse",
        timestamp: 2,
        content: [
          { type: "thinking", thinking: "hmm" },
          { type: "text", text: "Let me check" },
          { type: "toolCall", id: "t1", name: "bash", arguments: { command: "ls" } },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "t1",
        toolName: "bash",
        isError: false,
        timestamp: 3,
        content: [{ type: "text", text: "file.txt" }],
      },
    ] as any);

    expect(ops).toEqual([
      { type: "user", text: "hello" },
      { type: "assistant_start" },
      { type: "assistant_thinking", text: "hmm" },
      { type: "assistant_text", text: "Let me check" },
      { type: "assistant_tool_call", id: "t1", name: "bash", args: { command: "ls" } },
      { type: "assistant_end" },
      { type: "tool_result", id: "t1", name: "bash", output: "file.txt", isError: false },
    ]);
  });

  it("includes image placeholders in display text", () => {
    const ops = buildSessionHistoryOps([
      {
        role: "user",
        content: [
          { type: "text", text: "see this" },
          { type: "image", data: "abcd", mimeType: "image/png" },
        ],
        timestamp: 1,
      },
    ] as any);

    expect(ops).toEqual([{ type: "user", text: "see this[image:image/png]" }]);
  });
});
