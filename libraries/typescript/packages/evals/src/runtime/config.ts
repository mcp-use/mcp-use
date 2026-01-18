import { z } from "zod";

/**
 * Zod schema for agent configuration in eval.config.json.
 * Defines LLM provider and model settings.
 */
export const AgentConfigSchema = z.object({
  /** LLM provider name (e.g., "anthropic", "openai") */
  provider: z.string().min(1),
  /** Model identifier (e.g., "claude-3-5-sonnet-20241022", "gpt-4") */
  model: z.string().min(1),
  /** Optional base URL for OpenAI-compatible providers */
  baseUrl: z.string().min(1).optional(),
});

/**
 * Zod schema for evaluation defaults in eval.config.json.
 * Defines default settings for test execution.
 */
export const EvalDefaultsSchema = z.object({
  /** Default timeout for eval runs in milliseconds */
  timeout: z.number().int().nonnegative(),
  /** Number of retry attempts for failed evals */
  retries: z.number().int().nonnegative(),
  /** Server lifecycle: "suite" (reuse) or "test" (recreate per test) */
  serverLifecycle: z.enum(["suite", "test"]),
  /** Optional additional instructions to include in agent prompt */
  additionalInstructions: z.string().optional(),
});

/**
 * Zod schema for the complete eval configuration file.
 * Validates the structure of eval.config.json.
 */
export const EvalConfigSchema = z.object({
  /** Default agent keys for run and judge operations */
  default: z.object({
    /** Key of the agent config to use for running evals */
    runAgent: z.string().min(1),
    /** Key of the agent config to use for judging results */
    judgeAgent: z.string().min(1),
  }),
  /** Map of agent configuration keys to their settings */
  agents: z.record(z.string(), AgentConfigSchema),
  /** Map of MCP server configuration keys to their settings */
  servers: z.record(z.string(), z.unknown()),
  /** Default settings for test execution */
  defaults: EvalDefaultsSchema,
});

/**
 * TypeScript type for complete eval configuration.
 * Inferred from EvalConfigSchema.
 *
 * @example
 * ```typescript
 * const config: EvalConfig = {
 *   default: {
 *     runAgent: "sonnet",
 *     judgeAgent: "haiku"
 *   },
 *   agents: {
 *     sonnet: {
 *       provider: "anthropic",
 *       model: "claude-3-5-sonnet-20241022"
 *     }
 *   },
 *   servers: {
 *     weather: { command: "weather-server" }
 *   },
 *   defaults: {
 *     timeout: 30000,
 *     retries: 0,
 *     serverLifecycle: "suite"
 *   }
 * };
 * ```
 */
export type EvalConfig = z.infer<typeof EvalConfigSchema>;

/**
 * TypeScript type for agent configuration.
 * Inferred from AgentConfigSchema.
 */
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

/**
 * TypeScript type for evaluation defaults.
 * Inferred from EvalDefaultsSchema.
 */
export type EvalDefaults = z.infer<typeof EvalDefaultsSchema>;
