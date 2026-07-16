import type { ZodSchema } from "zod";
import type { ProviderMessage } from "../llm/types.js";
import type { BaseMessage } from "./types.js";

export interface RunOptions<T = string> {
  prompt?: string;
  maxSteps?: number;
  manageConnector?: boolean;
  externalHistory?: BaseMessage[];
  messages?: ProviderMessage[];
  schema?: ZodSchema<T>;
  signal?: AbortSignal;
}
