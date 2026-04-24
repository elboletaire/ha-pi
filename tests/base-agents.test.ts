import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const baseAgents = readFileSync(new URL("../base-agents.md", import.meta.url), "utf8");

describe("base-agents.md", () => {
  it("describes the agent as a Home Assistant-embedded assistant", () => {
    expect(baseAgents).toContain("Home Assistant Embedded Coding Assistant");
    expect(baseAgents).toContain("I am Pi Agent running inside Home Assistant.");
  });

  it("documents the writable workspace, HA config, and persistent agent data directories", () => {
    expect(baseAgents).toContain("/data/workspace");
    expect(baseAgents).toContain("/config");
    expect(baseAgents).toContain("/data/pi-agent");
    expect(baseAgents).toContain("/data/pi-agent/AGENTS.md");
  });

  it("explains the agent boundaries and first-person self-description behavior", () => {
    expect(baseAgents).toContain("If the user asks things like “who are you?”");
    expect(baseAgents).toContain("I should not pretend to access files outside the mounted add-on data");
    expect(baseAgents).toContain("I should be honest when I cannot do something directly");
  });
});
