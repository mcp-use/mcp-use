import type { ZodSchema } from "zod";
import type { ProviderMessage } from "../llm/types.js";
import type { RunOptions } from "./run_options.js";
import type { BaseMessage } from "./types.js";

export function normalizeRunOptions<T>(
  queryOrOptions: string | RunOptions<T>,
  maxSteps?: number,
  manageConnector?: boolean,
  externalHistory?: unknown,
  outputSchema?: ZodSchema<T>,
  signal?: AbortSignal
): {
  prompt?: string;
  maxSteps?: number;
  manageConnector?: boolean;
  externalHistory?: BaseMessage[];
  messages?: ProviderMessage[];
  schema?: ZodSchema<T>;
  signal?: AbortSignal;
} {
  if (typeof queryOrOptions === "object" && queryOrOptions !== null) {
    return {
      prompt: queryOrOptions.prompt,
      maxSteps: queryOrOptions.maxSteps,
      manageConnector: queryOrOptions.manageConnector,
      externalHistory: queryOrOptions.externalHistory,
      messages: queryOrOptions.messages,
      schema: queryOrOptions.schema,
      signal: queryOrOptions.signal,
    };
  }
  if (externalHistory !== undefined && !Array.isArray(externalHistory)) {
    throw new TypeError(
      "externalHistory must be an array of LangChain messages"
    );
  }
  return {
    prompt: queryOrOptions as string,
    maxSteps,
    manageConnector,
    externalHistory: externalHistory as BaseMessage[] | undefined,
    schema: outputSchema,
    signal,
  };
}
