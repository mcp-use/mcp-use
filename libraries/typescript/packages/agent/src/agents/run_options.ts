import type { ZodSchema } from "zod";
import type { ProviderMessage } from "../llm/types.js";
import type { BaseMessage } from "./types.js";

/** Options shared by `run`, `stream`, and `streamEvents`. */
export interface RunOptions<T = string> {
  /** User request for this run. */
  prompt?: string;
  /** Maximum model/tool-loop steps for this run. */
  maxSteps?: number;
  /**
   * Lets the agent initialize and clean up connectors for this run.
   * Defaults to `true`.
   */
  manageConnector?: boolean;
  /**
   * Additional LangChain-formatted history for this call.
   *
   * The native agent appends it after memory-enabled stored conversation and
   * before `messages` and the current `prompt`. It does not clear or replace
   * stored memory.
   */
  externalHistory?: BaseMessage[];
  /**
   * Provider-neutral messages appended before `prompt`.
   *
   * Not supported when the agent was constructed with `agentId` (remote mode):
   * the remote agent protocol does not carry a pre-seeded message list and will
   * throw at runtime if this field is non-empty.
   */
  messages?: ProviderMessage[];
  /**
   * Zod schema for a typed result.
   *
   * Structured output is supported by the LangChain entry point and remote
   * agents. The native local agent rejects this option.
   */
  schema?: ZodSchema<T>;
  /** Cancels model requests and agent execution. */
  signal?: AbortSignal;
}
