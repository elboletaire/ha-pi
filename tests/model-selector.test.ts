import { describe, expect, it } from "vitest";
import { modelKey, sortAndFilterModels } from "../frontend/model-selector";

describe("model selector helpers", () => {
  const models = [
    { provider: "openai", id: "gpt-4o", name: "GPT-4o" },
    { provider: "anthropic", id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
    { provider: "github-copilot", id: "gpt-4.1", name: "GPT-4.1" },
  ] as const;

  it("sorts the current model first", () => {
    const sorted = sortAndFilterModels(
      models as unknown as Array<(typeof models)[number]>,
      "",
      modelKey(models[1])
    );

    expect(sorted.map(modelKey)).toEqual([
      "anthropic/claude-sonnet-4-5",
      "github-copilot/gpt-4.1",
      "openai/gpt-4o",
    ]);
  });

  it("filters by provider, id, name, and canonical key tokens", () => {
    expect(
      sortAndFilterModels(
        models as unknown as Array<(typeof models)[number]>,
        "claude sonnet",
        ""
      ).map(modelKey)
    ).toEqual(["anthropic/claude-sonnet-4-5"]);

    expect(
      sortAndFilterModels(
        models as unknown as Array<(typeof models)[number]>,
        "github gpt-4.1",
        ""
      ).map(modelKey)
    ).toEqual(["github-copilot/gpt-4.1"]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(
      sortAndFilterModels(
        models as unknown as Array<(typeof models)[number]>,
        "does-not-exist",
        ""
      )
    ).toEqual([]);
  });
});
