import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const configYaml = readFileSync(new URL("../config.yaml", import.meta.url), "utf8");

describe("add-on config", () => {
  it("mounts /data and /config read/write", () => {
    expect(configYaml).toContain("- data:rw");
    expect(configYaml).toContain("- config:rw");
  });
});
