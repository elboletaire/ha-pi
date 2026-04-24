import { mkdir, appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { RiskLevel } from "../types/contracts";

export interface AuditRecord {
  timestamp: string;
  actor?: string;
  session_id: string;
  command: string;
  targets: string[];
  payload_hash: string;
  payload_summary: string;
  confirmation_state: boolean;
  risk_level: RiskLevel;
  result: "success" | "partial" | "fail";
  error_code?: string;
  error_message?: string;
  correlation_id: string;
}

export class AuditLogger {
  private readonly path: string;
  private readonly sessionId: string;

  constructor(path: string, sessionId = randomUUID()) {
    this.path = path;
    this.sessionId = sessionId;
  }

  public getSessionId(): string {
    return this.sessionId;
  }

  public async log(record: Omit<AuditRecord, "timestamp" | "session_id">): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });

    const fullRecord: AuditRecord = {
      timestamp: new Date().toISOString(),
      session_id: this.sessionId,
      ...record,
    };

    await appendFile(this.path, `${JSON.stringify(fullRecord)}\n`, "utf8");
  }
}

export const hashPayload = (input: unknown): string =>
  createHash("sha256").update(JSON.stringify(input)).digest("hex");

export const summarizePayload = (input: Record<string, unknown>): string => {
  const keys = Object.keys(input).sort();
  if (keys.length === 0) {
    return "{}";
  }

  return keys.map((key) => `${key}=${compact(input[key])}`).join("; ");
};

const compact = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[len:${value.length}]`;
  }

  if (value && typeof value === "object") {
    return `{keys:${Object.keys(value as Record<string, unknown>).join(",")}}`;
  }

  return JSON.stringify(value);
};
