import { readFileSync, existsSync } from "fs";

export interface AddOnOptions {
  provider: string;
  model: string;
  logLevel: "debug" | "info" | "warn" | "error";
}

// Path constants — overridable via env vars for local dev / testing
export const PATHS = {
  piAgentDir:    process.env.PI_CODING_AGENT_DIR ?? "/data/pi-agent",
  workspace:     process.env.HA_PI_WORKSPACE     ?? "/data/workspace",
  bundledSkills: process.env.HA_PI_SKILLS_DIR    ?? "/app/bundled-skills",
  baseAgentsMd:  process.env.HA_PI_BASE_AGENTS   ?? "/app/base-agents.md",
};

/**
 * Parses CLI args passed by run.sh.
 * run.sh reads /data/options.json via bashio and passes values as CLI flags.
 */
export function parseServerArgs(): AddOnOptions {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
  };

  const logLevel = get("--log-level", "info");

  return {
    provider: get("--provider", "anthropic"),
    model: get("--model", "claude-sonnet-4-5-20250929"),
    logLevel: (["debug", "info", "warn", "error"].includes(logLevel)
      ? logLevel
      : "info") as AddOnOptions["logLevel"],
  };
}

/**
 * Simple logger that respects the configured log level.
 */
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
let currentLevel: number = LEVELS.info;

export function setLogLevel(level: AddOnOptions["logLevel"]) {
  currentLevel = LEVELS[level];
}

export const log = {
  debug: (...args: unknown[]) => currentLevel <= LEVELS.debug && console.debug("[pi-agent]", ...args),
  info: (...args: unknown[])  => currentLevel <= LEVELS.info  && console.info("[pi-agent]",  ...args),
  warn: (...args: unknown[])  => currentLevel <= LEVELS.warn  && console.warn("[pi-agent]",  ...args),
  error: (...args: unknown[]) => currentLevel <= LEVELS.error && console.error("[pi-agent]", ...args),
};
