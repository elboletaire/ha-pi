import { randomUUID } from "node:crypto";
import type { HaBridge } from "../ha/bridge";
import { AuditLogger, hashPayload, summarizePayload } from "../lib/audit-log";
import type { CapabilitySnapshotStore } from "../lib/capability-snapshot";
import type { FileCache } from "../lib/cache";
import { HelperCliError } from "../lib/errors";
import { assessRisk, isMutatingCommand } from "../lib/risk";
import { extractTargets } from "../lib/targets";
import type { HelperEnvelope, MutationData } from "../types/contracts";
import { okEnvelope } from "../types/contracts";

export interface CommandExecutionContext {
  ha: HaBridge;
  audit: AuditLogger;
  cache: FileCache;
  capabilitySnapshots: CapabilitySnapshotStore;
  discoveryCacheTtlMs: number;
  capabilityTtlMs: number;
  confirm: boolean;
  dryRun: boolean;
  actor?: string;
}

export const runCommand = async (
  command: string,
  input: Record<string, unknown>,
  context: CommandExecutionContext,
): Promise<HelperEnvelope> => {
  const config = await safeConfigRead(context.ha);
  const meta = {
    ha_version: config.version,
  };

  switch (command) {
    case "state.list": {
      const states = await context.ha.getStates();
      return okEnvelope({ states }, meta);
    }

    case "state.get": {
      const entityId = requireString(input, "entity_id");
      const state = await context.ha.getState(entityId);
      if (!state) {
        throw new HelperCliError("NOT_FOUND", `Entity not found: ${entityId}`);
      }

      return okEnvelope({ state }, meta);
    }

    case "state.subscribe": {
      const eventType = optionalString(input, "event_type");
      const durationSeconds = optionalPositiveInteger(input, "duration_seconds");
      const maxEvents = optionalPositiveInteger(input, "max_events");

      const events = await context.ha.subscribeEvents({
        eventType,
        durationSeconds,
        maxEvents,
      });

      return okEnvelope(
        {
          events,
          count: events.length,
          event_type: eventType ?? null,
          duration_seconds: durationSeconds ?? 15,
        },
        meta,
      );
    }

    case "service.list": {
      const services = await getCached(
        context,
        "discovery:service.list",
        context.discoveryCacheTtlMs,
        () => context.ha.listServices(),
      );
      return okEnvelope({ services }, meta);
    }

    case "service.call": {
      const domain = requireString(input, "domain");
      const service = requireString(input, "service");
      const serviceData = asObject(input.service_data, "service_data");
      const target = asObject(input.target, "target", true);

      return runMutation(
        command,
        input,
        {
          actionSummary: `Call ${domain}.${service}`,
          targets: extractTargets(input),
          execute: () =>
            context.ha.callService({
              domain,
              service,
              service_data: serviceData,
              target,
            }),
        },
        context,
        meta,
      );
    }

    case "z2m.device.rename": {
      const from = requireString(input, "from");
      const to = requireString(input, "to");
      const homeassistantRename = optionalBoolean(input, "homeassistant_rename") ?? true;
      const explicitTopicPrefix = optionalString(input, "topic_prefix");
      const qos = optionalQos(input, "qos");
      const retain = optionalBoolean(input, "retain");
      const timeoutSeconds = optionalPositiveInteger(input, "timeout_seconds") ?? 25;
      const pollIntervalSeconds = optionalPositiveInteger(input, "poll_interval_seconds") ?? 2;

      const verifyDeviceId =
        optionalString(input, "device_id") ?? (await resolveDeviceIdForZ2mRename(context.ha, from));

      if (!verifyDeviceId) {
        throw new HelperCliError(
          "INVALID_INPUT",
          "Could not resolve target device_id. Provide 'device_id' explicitly for z2m.device.rename.",
        );
      }

      const topicPrefixes = explicitTopicPrefix
        ? [explicitTopicPrefix]
        : buildZ2mTopicPrefixCandidates();

      return runMutation(
        command,
        {
          ...input,
          device_id: verifyDeviceId,
          topic_prefixes: topicPrefixes,
        },
        {
          actionSummary: `Rename Zigbee2MQTT device '${from}' -> '${to}'`,
          targets: [verifyDeviceId, from, to],
          execute: () =>
            attemptZ2mRename(context.ha, {
              from,
              to,
              homeassistantRename,
              topicPrefixes,
              qos,
              retain,
              verifyDeviceId,
              timeoutSeconds,
              pollIntervalSeconds,
            }),
          onSuccess: () => context.cache.clear("discovery:"),
        },
        context,
        meta,
      );
    }

    case "registry.areas": {
      const areas = await getCached(
        context,
        "discovery:registry.areas",
        context.discoveryCacheTtlMs,
        () => context.ha.listAreas(),
      );
      return okEnvelope({ areas }, meta);
    }

    case "registry.devices": {
      const devices = await getCached(
        context,
        "discovery:registry.devices",
        context.discoveryCacheTtlMs,
        () => context.ha.listDevices(),
      );
      return okEnvelope({ devices }, meta);
    }

    case "registry.entities": {
      const entities = await getCached(
        context,
        "discovery:registry.entities",
        context.discoveryCacheTtlMs,
        () => context.ha.listEntityRegistry(),
      );
      return okEnvelope({ entities }, meta);
    }

    case "registry.labels": {
      const labels = await getCached(
        context,
        "discovery:registry.labels",
        context.discoveryCacheTtlMs,
        () => context.ha.listLabels(),
      );
      return okEnvelope({ labels }, meta);
    }

    case "registry.floors": {
      const floors = await getCached(
        context,
        "discovery:registry.floors",
        context.discoveryCacheTtlMs,
        () => context.ha.listFloors(),
      );
      return okEnvelope({ floors }, meta);
    }

    case "registry.entity.update": {
      const entityId = requireString(input, "entity_id");
      const changes = requireObject(input, "changes");

      return runMutation(
        command,
        { ...input, entity_id: entityId },
        {
          actionSummary: `Update entity registry metadata for ${entityId}`,
          targets: [entityId],
          execute: () =>
            context.ha.updateEntityRegistry({
              entityId,
              changes,
            }),
          onSuccess: () => context.cache.clear("discovery:"),
        },
        context,
        meta,
      );
    }

    case "registry.device.update": {
      const deviceId = requireString(input, "device_id");
      const changes = requireObject(input, "changes");

      return runMutation(
        command,
        { ...input, device_id: deviceId },
        {
          actionSummary: `Update device registry metadata for ${deviceId}`,
          targets: [deviceId],
          execute: () =>
            context.ha.updateDeviceRegistry({
              deviceId,
              changes,
            }),
          onSuccess: () => context.cache.clear("discovery:"),
        },
        context,
        meta,
      );
    }

    case "automation.list": {
      const automations = await listDomainStates(context.ha, "automation");
      return okEnvelope({ automations }, meta);
    }

    case "automation.trigger": {
      const entityId = requireString(input, "entity_id");
      const variables = asObject(input.variables, "variables", true);
      return runMutation(
        command,
        input,
        {
          actionSummary: `Trigger automation ${entityId}`,
          targets: [entityId],
          execute: () =>
            context.ha.callService({
              domain: "automation",
              service: "trigger",
              target: { entity_id: entityId },
              service_data: variables,
            }),
        },
        context,
        meta,
      );
    }

    case "automation.enable": {
      const entityIds = resolveEntityIds(input);
      return runMutation(
        command,
        { ...input, entity_ids: entityIds },
        {
          actionSummary: `Enable ${entityIds.length} automation(s)`,
          targets: entityIds,
          execute: () =>
            context.ha.callService({
              domain: "automation",
              service: "turn_on",
              target: { entity_id: entityIds },
            }),
        },
        context,
        meta,
      );
    }

    case "automation.disable": {
      const entityIds = resolveEntityIds(input);
      return runMutation(
        command,
        { ...input, entity_ids: entityIds },
        {
          actionSummary: `Disable ${entityIds.length} automation(s)`,
          targets: entityIds,
          execute: () =>
            context.ha.callService({
              domain: "automation",
              service: "turn_off",
              target: { entity_id: entityIds },
            }),
        },
        context,
        meta,
      );
    }

    case "automation.reload": {
      return runMutation(
        command,
        input,
        {
          actionSummary: "Reload all automations",
          targets: [],
          execute: () =>
            context.ha.callService({
              domain: "automation",
              service: "reload",
            }),
        },
        context,
        meta,
      );
    }

    case "script.list": {
      const scripts = await listDomainStates(context.ha, "script");
      return okEnvelope({ scripts }, meta);
    }

    case "script.run": {
      const entityId = requireString(input, "entity_id");
      const variables = asObject(input.variables, "variables", true);
      return runMutation(
        command,
        input,
        {
          actionSummary: `Run script ${entityId}`,
          targets: [entityId],
          execute: () =>
            context.ha.callService({
              domain: "script",
              service: "turn_on",
              target: { entity_id: entityId },
              service_data: variables,
            }),
        },
        context,
        meta,
      );
    }

    case "script.stop": {
      const entityId = requireString(input, "entity_id");
      return runMutation(
        command,
        input,
        {
          actionSummary: `Stop script ${entityId}`,
          targets: [entityId],
          execute: () =>
            context.ha.callService({
              domain: "script",
              service: "turn_off",
              target: { entity_id: entityId },
            }),
        },
        context,
        meta,
      );
    }

    case "scene.list": {
      const scenes = await listDomainStates(context.ha, "scene");
      return okEnvelope({ scenes }, meta);
    }

    case "scene.activate": {
      const entityId = requireString(input, "entity_id");
      return runMutation(
        command,
        input,
        {
          actionSummary: `Activate scene ${entityId}`,
          targets: [entityId],
          execute: () =>
            context.ha.callService({
              domain: "scene",
              service: "turn_on",
              target: { entity_id: entityId },
            }),
        },
        context,
        meta,
      );
    }

    case "history.query": {
      const history = await context.ha.queryHistory({
        start: optionalString(input, "start"),
        end: optionalString(input, "end"),
        entityId: optionalString(input, "entity_id"),
      });
      return okEnvelope({ history }, meta);
    }

    case "logbook.query": {
      const entries = await context.ha.queryLogbook({
        start: optionalString(input, "start"),
        end: optionalString(input, "end"),
        entityId: optionalString(input, "entity_id"),
      });
      return okEnvelope({ entries }, meta);
    }

    case "statistics.query": {
      const statistics = await context.ha.queryStatistics({
        start: optionalString(input, "start"),
        end: optionalString(input, "end"),
        statisticIds: optionalStringArray(input, "statistic_ids"),
        period: optionalStatisticsPeriod(input, "period"),
        units: asObject(input.units, "units", true),
      });
      return okEnvelope({ statistics }, meta);
    }

    case "system.capabilities": {
      const forceRefresh = optionalBoolean(input, "force_refresh") ?? false;
      const capabilities = await collectCapabilities(context, meta.ha_version, forceRefresh);
      return okEnvelope({ capabilities }, meta);
    }

    case "system.cache.clear": {
      const prefix = optionalString(input, "prefix");
      const removed = await context.cache.clear(prefix);
      return okEnvelope({ removed, prefix: prefix ?? null }, meta);
    }

    case "ws.send": {
      const type = requireString(input, "type");
      const result = await context.ha.sendRaw({ ...input, type });
      return okEnvelope({ result }, meta);
    }

    default:
      throw new HelperCliError("INVALID_INPUT", `Unsupported command: ${command}`);
  }
};

const listDomainStates = async (
  ha: HaBridge,
  domain: string,
): Promise<Array<Record<string, unknown>>> => {
  const states = await ha.getStates();

  return states.filter((state) => {
    const entityId = state.entity_id;
    return typeof entityId === "string" && entityId.startsWith(`${domain}.`);
  });
};

const requireString = (input: Record<string, unknown>, key: string): string => {
  const value = input[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HelperCliError("INVALID_INPUT", `Missing required string field: ${key}`);
  }

  return value;
};

const optionalString = (input: Record<string, unknown>, key: string): string | undefined => {
  const value = input[key];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new HelperCliError("INVALID_INPUT", `${key} must be a string`);
  }

  return value.trim().length > 0 ? value : undefined;
};

const optionalBoolean = (input: Record<string, unknown>, key: string): boolean | undefined => {
  const value = input[key];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new HelperCliError("INVALID_INPUT", `${key} must be a boolean`);
  }

  return value;
};

const optionalPositiveInteger = (
  input: Record<string, unknown>,
  key: string,
): number | undefined => {
  const value = input[key];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new HelperCliError("INVALID_INPUT", `${key} must be a positive integer`);
  }

  return value;
};

const optionalQos = (input: Record<string, unknown>, key: string): 0 | 1 | 2 | undefined => {
  const value = input[key];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || ![0, 1, 2].includes(value)) {
    throw new HelperCliError("INVALID_INPUT", `${key} must be one of: 0, 1, 2`);
  }

  return value as 0 | 1 | 2;
};

const optionalStringArray = (
  input: Record<string, unknown>,
  key: string,
): string[] | undefined => {
  const value = input[key];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new HelperCliError("INVALID_INPUT", `${key} must be a string[]`);
  }

  return value;
};

const optionalStatisticsPeriod = (
  input: Record<string, unknown>,
  key: string,
): "5minute" | "hour" | "day" | "month" | undefined => {
  const value = input[key];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (
    typeof value !== "string" ||
    !["5minute", "hour", "day", "month"].includes(value)
  ) {
    throw new HelperCliError(
      "INVALID_INPUT",
      `${key} must be one of: 5minute, hour, day, month`,
    );
  }

  return value as "5minute" | "hour" | "day" | "month";
};

const requireObject = (input: Record<string, unknown>, keyName: string): Record<string, unknown> => {
  const value = input[keyName];

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HelperCliError("INVALID_INPUT", `${keyName} must be an object`);
  }

  return value as Record<string, unknown>;
};

const asObject = (
  value: unknown,
  keyName: string,
  optional = false,
): Record<string, unknown> | undefined => {
  if (value === undefined || value === null) {
    if (optional) {
      return undefined;
    }

    return {};
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HelperCliError("INVALID_INPUT", `${keyName} must be an object`);
  }

  return value as Record<string, unknown>;
};

const resolveEntityIds = (input: Record<string, unknown>): string[] => {
  const single = input.entity_id;
  const plural = input.entity_ids;

  if (typeof single === "string" && single.trim().length > 0) {
    return [single];
  }

  if (Array.isArray(plural)) {
    const ids = plural.filter((value): value is string => typeof value === "string");
    if (ids.length > 0) {
      return ids;
    }
  }

  throw new HelperCliError(
    "INVALID_INPUT",
    "Provide entity_id (string) or entity_ids (string[])",
  );
};

interface MutationRunConfig {
  actionSummary: string;
  targets: string[];
  execute: () => Promise<Record<string, unknown>>;
  onSuccess?: () => Promise<unknown>;
}

const runMutation = async (
  command: string,
  input: Record<string, unknown>,
  config: MutationRunConfig,
  context: CommandExecutionContext,
  meta: { ha_version?: string },
): Promise<HelperEnvelope<MutationData>> => {
  if (!isMutatingCommand(command)) {
    throw new HelperCliError("INTERNAL_ERROR", "runMutation called for a read-only command");
  }

  const risk = assessRisk(command, input);
  const correlationId = randomUUID();

  if (risk.requiresConfirmation && !context.confirm) {
    throw new HelperCliError(
      "CONFIRMATION_REQUIRED",
      `Command '${command}' requires --confirm (${risk.reason})`,
      {
        details: {
          risk_level: risk.level,
        },
      },
    );
  }

  const payloadHash = hashPayload(input);
  const payloadSummary = summarizePayload(input);

  if (context.dryRun) {
    await context.audit.log({
      actor: context.actor,
      command,
      targets: config.targets,
      payload_hash: payloadHash,
      payload_summary: payloadSummary,
      confirmation_state: context.confirm,
      risk_level: risk.level,
      result: "partial",
      correlation_id: correlationId,
    });

    return okEnvelope(
      {
        action_summary: config.actionSummary,
        targets: config.targets,
        confirmed: context.confirm,
        risk_level: risk.level,
        dry_run: true,
      },
      {
        ...meta,
        correlation_id: correlationId,
      },
    );
  }

  try {
    const result = await config.execute();

    if (config.onSuccess) {
      await config.onSuccess();
    }

    await context.audit.log({
      actor: context.actor,
      command,
      targets: config.targets,
      payload_hash: payloadHash,
      payload_summary: payloadSummary,
      confirmation_state: context.confirm,
      risk_level: risk.level,
      result: "success",
      correlation_id: correlationId,
    });

    return okEnvelope(
      {
        action_summary: config.actionSummary,
        targets: config.targets,
        confirmed: context.confirm,
        risk_level: risk.level,
        result,
      },
      {
        ...meta,
        correlation_id: correlationId,
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof HelperCliError ? error.code : "HA_API_ERROR";

    await context.audit.log({
      actor: context.actor,
      command,
      targets: config.targets,
      payload_hash: payloadHash,
      payload_summary: payloadSummary,
      confirmation_state: context.confirm,
      risk_level: risk.level,
      result: "fail",
      error_code: code,
      error_message: message,
      correlation_id: correlationId,
    });

    throw error;
  }
};

const collectCapabilities = async (
  context: CommandExecutionContext,
  haVersion: string | undefined,
  forceRefresh: boolean,
): Promise<Record<string, unknown>> => {
  const snapshot = await context.capabilitySnapshots.get();

  if (!forceRefresh && snapshot) {
    const fetchedAt = new Date(snapshot.fetched_at).getTime();
    const notExpired = Date.now() - fetchedAt < context.capabilityTtlMs;
    const sameVersion = snapshot.ha_version === haVersion;

    if (notExpired && sameVersion) {
      return {
        ...snapshot.capabilities,
        snapshot: {
          source: "cache",
          fetched_at: snapshot.fetched_at,
          instance_id: snapshot.instance_id,
        },
      };
    }
  }

  const probeEntityId = await resolveCapabilityProbeEntityId(context.ha);

  const labels = await probeCapability(async () => {
    await context.ha.listLabels();
  });
  const floors = await probeCapability(async () => {
    await context.ha.listFloors();
  });
  const history = await probeCapability(async () => {
    await context.ha.queryHistory({ entityId: probeEntityId });
  });
  const logbook = await probeCapability(async () => {
    await context.ha.queryLogbook({ entityId: probeEntityId });
  });
  const statistics = await probeCapability(async () => {
    await context.ha.queryStatistics({ statisticIds: ["sensor.__capability_probe__"] });
  });

  const capabilities = {
    commands: {
      state: ["state.list", "state.get", "state.subscribe"],
      service: ["service.list", "service.call"],
      z2m: ["z2m.device.rename"],
      registry: [
        "registry.areas",
        "registry.devices",
        "registry.entities",
        "registry.labels",
        "registry.floors",
        "registry.entity.update",
        "registry.device.update",
      ],
      automation: [
        "automation.list",
        "automation.trigger",
        "automation.enable",
        "automation.disable",
        "automation.reload",
      ],
      script: ["script.list", "script.run", "script.stop"],
      scene: ["scene.list", "scene.activate"],
      history: ["history.query"],
      logbook: ["logbook.query"],
      statistics: ["statistics.query"],
      system: ["system.capabilities", "system.cache.clear"],
    },
    feature_flags: {
      labels,
      floors,
      history,
      logbook,
      statistics,
    },
  };

  await context.capabilitySnapshots.set({
    ha_version: haVersion,
    capabilities,
  });

  return {
    ...capabilities,
    snapshot: {
      source: "live",
      fetched_at: new Date().toISOString(),
      instance_id: context.capabilitySnapshots.getInstanceId(),
    },
  };
};

const getCached = async <T>(
  context: CommandExecutionContext,
  key: string,
  ttlMs: number,
  fetchValue: () => Promise<T>,
): Promise<T> => {
  const cached = await context.cache.get<T>(key);
  if (cached !== null) {
    return cached;
  }

  const live = await fetchValue();
  await context.cache.set(key, live, ttlMs);
  return live;
};

interface Z2mRenameAttemptInput {
  from: string;
  to: string;
  homeassistantRename: boolean;
  topicPrefixes: string[];
  qos?: 0 | 1 | 2;
  retain?: boolean;
  verifyDeviceId: string;
  timeoutSeconds: number;
  pollIntervalSeconds: number;
}

const attemptZ2mRename = async (
  ha: HaBridge,
  input: Z2mRenameAttemptInput,
): Promise<Record<string, unknown>> => {
  const initialName = await readDeviceName(ha, input.verifyDeviceId);

  if (
    initialName &&
    !isLikelyZ2mIdentifier(input.from) &&
    initialName !== input.from
  ) {
    throw new HelperCliError(
      "INVALID_INPUT",
      `Z2M rename preflight failed: device '${input.verifyDeviceId}' currently has name '${initialName}', not '${input.from}'.`,
    );
  }

  const triedTopics: string[] = [];
  let lastSeenName: string | null = initialName;

  for (const topicPrefix of input.topicPrefixes) {
    const topic = buildZ2mRenameTopic(topicPrefix);
    triedTopics.push(topic);

    const serviceData: Record<string, unknown> = {
      topic,
      payload: JSON.stringify({
        from: input.from,
        to: input.to,
        homeassistant_rename: input.homeassistantRename,
      }),
    };

    if (input.qos !== undefined) {
      serviceData.qos = input.qos;
    }

    if (input.retain !== undefined) {
      serviceData.retain = input.retain;
    }

    const publishResult = await ha.callService({
      domain: "mqtt",
      service: "publish",
      service_data: serviceData,
    });

    const verify = await waitForDeviceName(
      ha,
      input.verifyDeviceId,
      input.to,
      input.timeoutSeconds,
      input.pollIntervalSeconds,
    );

    lastSeenName = verify.lastSeenName;

    if (verify.matched) {
      return {
        publish_result: publishResult,
        verified: true,
        used_topic: topic,
        verify_device_id: input.verifyDeviceId,
        final_name: verify.lastSeenName,
      };
    }
  }

  throw new HelperCliError(
    "HA_API_ERROR",
    `Z2M rename did not verify for device '${input.verifyDeviceId}'. Name did not become '${input.to}'.`,
    {
      details: {
        from: input.from,
        to: input.to,
        verify_device_id: input.verifyDeviceId,
        tried_topics: triedTopics,
        last_seen_name: lastSeenName,
      },
      retriable: false,
    },
  );
};

const resolveDeviceIdForZ2mRename = async (
  ha: HaBridge,
  from: string,
): Promise<string | undefined> => {
  const devices = await ha.listDevices();

  const byId = devices.find((device) => device.id === from);
  if (byId?.id && typeof byId.id === "string") {
    return byId.id;
  }

  const byName = devices.find(
    (device) => device.name === from || device.name_by_user === from,
  );
  if (byName?.id && typeof byName.id === "string") {
    return byName.id;
  }

  const normalized = from.toLowerCase();
  const byIdentifiers = devices.find((device) => {
    const identifiers = device.identifiers;
    if (!Array.isArray(identifiers)) {
      return false;
    }

    return JSON.stringify(identifiers).toLowerCase().includes(normalized);
  });

  if (byIdentifiers?.id && typeof byIdentifiers.id === "string") {
    return byIdentifiers.id;
  }

  return undefined;
};

const waitForDeviceName = async (
  ha: HaBridge,
  deviceId: string,
  expectedName: string,
  timeoutSeconds: number,
  pollIntervalSeconds: number,
): Promise<{ matched: boolean; lastSeenName: string | null }> => {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let lastSeenName: string | null = null;

  while (Date.now() <= deadline) {
    const devices = await ha.listDevices();
    const device = devices.find((entry) => entry.id === deviceId);

    if (device) {
      const name = typeof device.name === "string" ? device.name : null;
      lastSeenName = name;

      if (name === expectedName) {
        return {
          matched: true,
          lastSeenName,
        };
      }
    }

    await sleep(pollIntervalSeconds * 1000);
  }

  return {
    matched: false,
    lastSeenName,
  };
};

const buildZ2mTopicPrefixCandidates = (): string[] => [
  "zigbee2mqtt_home",
  "/zigbee2mqtt",
  "zigbee2mqtt",
  "/homebee",
  "homebee",
];

const buildZ2mRenameTopic = (topicPrefix: string): string =>
  `${topicPrefix.replace(/\/$/, "")}/bridge/request/device/rename`;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const readDeviceName = async (
  ha: HaBridge,
  deviceId: string,
): Promise<string | null> => {
  const devices = await ha.listDevices();
  const device = devices.find((entry) => entry.id === deviceId);
  return typeof device?.name === "string" ? device.name : null;
};

const isLikelyZ2mIdentifier = (value: string): boolean =>
  /^0x[0-9a-f]+$/i.test(value) || value.startsWith("zigbee2mqtt_");

const probeCapability = async (fn: () => Promise<void>): Promise<boolean> => {
  try {
    await fn();
    return true;
  } catch (error) {
    if (
      error instanceof HelperCliError &&
      [
        "CAPABILITY_UNAVAILABLE",
        "PERMISSION_DENIED",
        "AUTH_ERROR",
        "HA_API_ERROR",
        "TIMEOUT",
      ].includes(error.code)
    ) {
      return false;
    }

    throw error;
  }
};

const resolveCapabilityProbeEntityId = async (ha: HaBridge): Promise<string | undefined> => {
  try {
    const states = await ha.getStates();
    const firstStateWithEntityId = states.find(
      (state) => typeof state.entity_id === "string" && state.entity_id.length > 0,
    );

    if (!firstStateWithEntityId) {
      return undefined;
    }

    return firstStateWithEntityId.entity_id as string;
  } catch {
    return undefined;
  }
};

const safeConfigRead = async (
  ha: HaBridge,
): Promise<{ version?: string; [key: string]: unknown }> => {
  try {
    return await ha.getConfig();
  } catch {
    return {};
  }
};
