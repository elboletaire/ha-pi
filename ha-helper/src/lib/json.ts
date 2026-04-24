import { readFile } from "node:fs/promises";
import { HelperCliError } from "./errors";

export const parseJsonObjectInput = (raw?: string): Record<string, unknown> => {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new HelperCliError("INVALID_INPUT", "--input must be a JSON object");
    }

    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HelperCliError) {
      throw error;
    }

    throw new HelperCliError("INVALID_INPUT", "Failed to parse --input JSON", {
      details: error,
    });
  }
};

export const parseJsonObjectInputFromSources = async (
  inputRaw?: string,
  inputFile?: string,
): Promise<Record<string, unknown>> => {
  if (inputRaw && inputFile) {
    throw new HelperCliError("INVALID_INPUT", "Use either --input or --input-file, not both");
  }

  if (inputFile) {
    let raw: string;

    try {
      raw = await readFile(inputFile, "utf8");
    } catch (error) {
      throw new HelperCliError("INVALID_INPUT", `Failed to read --input-file: ${inputFile}`, {
        details: error,
      });
    }

    return parseJsonObjectInput(raw);
  }

  return parseJsonObjectInput(inputRaw);
};

export const stringify = (value: unknown): string => JSON.stringify(value, null, 2);
