import type { RiskLevel } from "../types/contracts";
import { countTargets } from "./targets";

export interface RiskAssessment {
  level: RiskLevel;
  requiresConfirmation: boolean;
  reason: string;
}

const confirmByLevel = (level: RiskLevel): boolean =>
  level === "medium" || level === "high";

export const isMutatingCommand = (command: string): boolean =>
  [
    "service.call",
    "automation.trigger",
    "automation.enable",
    "automation.disable",
    "automation.reload",
    "script.run",
    "script.stop",
    "scene.activate",
    "z2m.device.rename",
    "registry.entity.update",
    "registry.device.update",
  ].includes(command);

export const assessRisk = (
  command: string,
  input: Record<string, unknown>,
): RiskAssessment => {
  if (!isMutatingCommand(command)) {
    return {
      level: "low",
      requiresConfirmation: false,
      reason: "Read-only command",
    };
  }

  const targetCount = countTargets(input);

  switch (command) {
    case "service.call": {
      const level: RiskLevel = targetCount >= 5 ? "high" : targetCount > 1 ? "medium" : "low";
      return {
        level,
        requiresConfirmation: confirmByLevel(level),
        reason: `Service call touching ${targetCount || 0} target(s)`,
      };
    }
    case "automation.disable":
    case "automation.enable": {
      const level: RiskLevel = targetCount >= 5 ? "high" : "medium";
      return {
        level,
        requiresConfirmation: true,
        reason: "Automation state change",
      };
    }
    case "automation.reload":
      return {
        level: "high",
        requiresConfirmation: true,
        reason: "Reload affects all automations",
      };
    case "automation.trigger":
    case "script.run":
    case "script.stop":
      return {
        level: "medium",
        requiresConfirmation: true,
        reason: "Execution command with side effects",
      };
    case "scene.activate":
      return {
        level: "medium",
        requiresConfirmation: true,
        reason: "Scene activation can alter multiple entities",
      };
    case "z2m.device.rename":
      return {
        level: "high",
        requiresConfirmation: true,
        reason: "Zigbee2MQTT rename can cascade entity ID changes",
      };
    case "registry.entity.update":
    case "registry.device.update":
      return {
        level: "high",
        requiresConfirmation: true,
        reason: "Registry metadata update can impact references and UI",
      };
    default:
      return {
        level: "medium",
        requiresConfirmation: true,
        reason: "Mutating command",
      };
  }
};
