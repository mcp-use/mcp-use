import type { ZodSchema } from "zod";
import type { ProviderMessage } from "../llm/types.js";
import type { RunOptions } from "./run_options.js";

export function normalizeRunOptions<T>(
  queryOrOptions: string | RunOptions<T>,
  maxSteps?: number,
  manageConnector?: boolean,
  _externalHistory?: unknown,
  outputSchema?: ZodSchema<T>,
  signal?: AbortSignal
): {
  prompt?: string;
  maxSteps?: number;
  manageConnector?: boolean;
  messages?: ProviderMessage[];
  schema?: ZodSchema<T>;
  signal?: AbortSignal;
} {
  if (typeof queryOrOptions === "object" && queryOrOptions !== null) {
    return {
      prompt: queryOrOptions.prompt,
      maxSteps: queryOrOptions.maxSteps,
      manageConnector: queryOrOptions.manageConnector,
      messages: queryOrOptions.messages,
      schema: queryOrOptions.schema,
      signal: queryOrOptions.signal,
    };
  }
  return {
    prompt: queryOrOptions as string,
    maxSteps,
    manageConnector,
    schema: outputSchema,
    signal,
  };
}
