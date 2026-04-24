#!/usr/bin/env node

import { AuditLogger } from "./lib/audit-log";
import { CapabilitySnapshotStore } from "./lib/capability-snapshot";
import { FileCache } from "./lib/cache";
import { HelperCliError, asError } from "./lib/errors";
import { parseJsonObjectInputFromSources, stringify } from "./lib/json";
import { errorEnvelope } from "./types/contracts";
import { runCommand } from "./commands/execute";
import { HaWsClient } from "./ha/ws-client";

interface ParsedArgs {
  command?: string;
  inputRaw?: string;
  inputFile?: string;
  confirm: boolean;
  dryRun: boolean;
  help: boolean;
  haUrl?: string;
  haToken?: string;
  auditPath: string;
  cachePath: string;
  capabilitiesPath: string;
  discoveryCacheTtlMs: number;
  capabilityTtlMs: number;
  actor?: string;
}

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || !args.command) {
    printUsage();
    process.exit(args.help ? 0 : 1);
    return;
  }

  const haUrl = args.haUrl ?? process.env.HA_URL ?? process.env.HASS_URL;
  const haToken = args.haToken ?? process.env.HA_TOKEN ?? process.env.HASS_TOKEN;

  if (!haUrl || !haToken) {
    throw new HelperCliError(
      "INVALID_INPUT",
      "Missing Home Assistant credentials. Set --ha-url/--ha-token or HA_URL/HA_TOKEN env vars.",
    );
  }

  const input = await parseJsonObjectInputFromSources(args.inputRaw, args.inputFile);
  const audit = new AuditLogger(args.auditPath);
  const cache = new FileCache(args.cachePath);
  const capabilitySnapshots = new CapabilitySnapshotStore(args.capabilitiesPath, haUrl);
  const ha = new HaWsClient({
    url: haUrl,
    token: haToken,
  });

  try {
    const envelope = await runCommand(args.command, input, {
      ha,
      audit,
      cache,
      capabilitySnapshots,
      discoveryCacheTtlMs: args.discoveryCacheTtlMs,
      capabilityTtlMs: args.capabilityTtlMs,
      confirm: args.confirm,
      dryRun: args.dryRun,
      actor: args.actor,
    });

    process.stdout.write(`${stringify(envelope)}\n`);
  } finally {
    await ha.disconnect();
  }
};

const parseArgs = (argv: string[]): ParsedArgs => {
  const parsed: ParsedArgs = {
    confirm: false,
    dryRun: false,
    help: false,
    auditPath: ".ha-helper/audit.jsonl",
    cachePath: ".ha-helper/cache.json",
    capabilitiesPath: ".ha-helper/capabilities.json",
    discoveryCacheTtlMs: 30_000,
    capabilityTtlMs: 3_600_000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    switch (token) {
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      case "--confirm":
        parsed.confirm = true;
        break;
      case "--dry-run":
        parsed.dryRun = true;
        break;
      case "--input":
        parsed.inputRaw = argv[++index];
        break;
      case "--input-file":
        parsed.inputFile = argv[++index];
        break;
      case "--ha-url":
        parsed.haUrl = argv[++index];
        break;
      case "--ha-token":
        parsed.haToken = argv[++index];
        break;
      case "--audit-log":
        parsed.auditPath = argv[++index];
        break;
      case "--cache-path":
        parsed.cachePath = argv[++index];
        break;
      case "--capabilities-path":
        parsed.capabilitiesPath = argv[++index];
        break;
      case "--discovery-cache-ttl-seconds":
        parsed.discoveryCacheTtlMs = parsePositiveSeconds(token, argv[++index]);
        break;
      case "--capability-ttl-seconds":
        parsed.capabilityTtlMs = parsePositiveSeconds(token, argv[++index]);
        break;
      case "--actor":
        parsed.actor = argv[++index];
        break;
      default:
        if (token.startsWith("--")) {
          throw new HelperCliError("INVALID_INPUT", `Unknown option: ${token}`);
        }

        if (!parsed.command) {
          parsed.command = token;
        } else {
          throw new HelperCliError("INVALID_INPUT", `Unexpected argument: ${token}`);
        }
    }
  }

  return parsed;
};

const parsePositiveSeconds = (flag: string, rawValue: string | undefined): number => {
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new HelperCliError("INVALID_INPUT", `${flag} must be a positive number`);
  }

  return Math.floor(numeric * 1000);
};

const printUsage = (): void => {
  const usage = [
    "HA helper CLI",
    "",
    "Usage:",
    "  ha-helper <command> [--input '{...}' | --input-file ./payload.json] [--confirm] [--dry-run]",
    "",
    "Connection:",
    "  --ha-url <url>      Home Assistant URL (or HA_URL/HASS_URL)",
    "  --ha-token <token>  Long-lived access token (or HA_TOKEN/HASS_TOKEN)",
    "",
    "General options:",
    "  --audit-log <path>                Audit JSONL file (default: .ha-helper/audit.jsonl)",
    "  --input-file <path>               Read JSON input payload from file",
    "  --cache-path <path>               Discovery cache file (default: .ha-helper/cache.json)",
    "  --capabilities-path <path>        Capability snapshot file (default: .ha-helper/capabilities.json)",
    "  --discovery-cache-ttl-seconds <n> Discovery cache TTL (default: 30)",
    "  --capability-ttl-seconds <n>      Capability snapshot TTL (default: 3600)",
    "  --actor <name>                    Optional actor/session label",
    "  --confirm                         Required for medium/high-risk mutating commands",
    "  --dry-run                         Validate and log mutation without executing",
    "",
    "Commands:",
    "  state.list",
    "  state.get",
    "  state.subscribe",
    "  service.list",
    "  service.call",
    "  z2m.device.rename",
    "  registry.areas | registry.devices | registry.entities | registry.labels | registry.floors",    
    "  registry.entity.update | registry.device.update",
    "  automation.list | automation.trigger | automation.enable | automation.disable | automation.reload",
    "  script.list | script.run | script.stop",
    "  scene.list | scene.activate",
    "  history.query | logbook.query | statistics.query",
    "  system.capabilities | system.cache.clear",
  ].join("\n");

  process.stdout.write(`${usage}\n`);
};

main().catch((error: unknown) => {
  if (error instanceof HelperCliError) {
    const envelope = errorEnvelope(error.code, error.message, error.details, error.retriable);
    process.stderr.write(`${stringify(envelope)}\n`);
    process.exit(1);
    return;
  }

  const unknownError = asError(error);
  const envelope = errorEnvelope("INTERNAL_ERROR", unknownError.message, {
    stack: unknownError.stack,
  });
  process.stderr.write(`${stringify(envelope)}\n`);
  process.exit(1);
});
