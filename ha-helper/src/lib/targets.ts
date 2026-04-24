const toArray = (value: unknown): string[] => {
  if (typeof value === "string" && value.trim().length > 0) {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  return [];
};

export const extractTargets = (input: Record<string, unknown>): string[] => {
  const targets = new Set<string>();

  const rootEntityIds = toArray(input.entity_id);
  rootEntityIds.forEach((entityId) => targets.add(entityId));

  const rootEntityIdsPlural = toArray(input.entity_ids);
  rootEntityIdsPlural.forEach((entityId) => targets.add(entityId));

  ["device_id", "device_ids", "area_id", "area_ids"].forEach((key) => {
    toArray(input[key]).forEach((value) => targets.add(value));
  });

  const target = input.target;
  if (target && typeof target === "object" && !Array.isArray(target)) {
    const maybeTarget = target as Record<string, unknown>;
    ["entity_id", "device_id", "area_id"].forEach((key) => {
      toArray(maybeTarget[key]).forEach((value) => targets.add(value));
    });
  }

  return [...targets];
};

export const countTargets = (input: Record<string, unknown>): number =>
  extractTargets(input).length;
