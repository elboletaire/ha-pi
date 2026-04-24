import type { HelperErrorCode } from "../types/contracts";

export class HelperCliError extends Error {
  public readonly code: HelperErrorCode;
  public readonly details?: unknown;
  public readonly retriable: boolean;

  constructor(
    code: HelperErrorCode,
    message: string,
    options: { details?: unknown; retriable?: boolean } = {},
  ) {
    super(message);
    this.name = "HelperCliError";
    this.code = code;
    this.details = options.details;
    this.retriable = options.retriable ?? false;
  }
}

export const asError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error;
  }

  return new Error(typeof error === "string" ? error : JSON.stringify(error));
};
