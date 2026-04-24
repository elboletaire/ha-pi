export type RiskLevel = "low" | "medium" | "high";

export type HelperErrorCode =
  | "INVALID_INPUT"
  | "AUTH_ERROR"
  | "PERMISSION_DENIED"
  | "CAPABILITY_UNAVAILABLE"
  | "CONFIRMATION_REQUIRED"
  | "NOT_FOUND"
  | "HA_API_ERROR"
  | "TIMEOUT"
  | "INTERNAL_ERROR";

export interface HelperError {
  code: HelperErrorCode;
  message: string;
  details?: unknown;
  retriable?: boolean;
}

export interface HelperMeta {
  timestamp: string;
  ha_version?: string;
  partial?: boolean;
  correlation_id?: string;
}

export interface HelperEnvelope<T = unknown> {
  ok: boolean;
  data: T | null;
  error: HelperError | null;
  meta: HelperMeta;
}

export interface MutationData {
  action_summary: string;
  targets: string[];
  confirmed: boolean;
  risk_level: RiskLevel;
  result?: unknown;
  dry_run?: boolean;
}

export const buildMeta = (
  partial = false,
  extra: Partial<HelperMeta> = {},
): HelperMeta => ({
  timestamp: new Date().toISOString(),
  partial,
  ...extra,
});

export const okEnvelope = <T>(
  data: T,
  meta: Partial<HelperMeta> = {},
): HelperEnvelope<T> => ({
  ok: true,
  data,
  error: null,
  meta: buildMeta(false, meta),
});

export const errorEnvelope = (
  code: HelperErrorCode,
  message: string,
  details?: unknown,
  retriable = false,
  meta: Partial<HelperMeta> = {},
): HelperEnvelope<null> => ({
  ok: false,
  data: null,
  error: {
    code,
    message,
    details,
    retriable,
  },
  meta: buildMeta(false, meta),
});
