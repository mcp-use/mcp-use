import type { ZodSchema } from "zod";
import type { ProviderMessage } from "../llm/types.js";
import type { BaseMessage } from "./types.js";

export interface RunOptions<T = string> {
  prompt?: string;
  maxSteps?: number;
  manageConnector?: boolean;
  /**
   * Additional LangChain-formatted history for this call.
   *
   * The native agent appends it after memory-enabled stored conversation and
   * before `messages` and the current `prompt`. It does not clear or replace
   * stored memory.
   */
  externalHistory?: BaseMessage[];
  messages?: ProviderMessage[];
  schema?: ZodSchema<T>;
  signal?: AbortSignal;
}
