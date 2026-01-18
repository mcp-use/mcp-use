/**
 * @module @mcp-use/evals
 *
 * Testing framework for MCP servers with LLM-powered evaluation agents.
 *
 * Provides tools for:
 * - Creating eval agents that interact with MCP servers
 * - Custom Vitest matchers for asserting agent behavior
 * - Semantic similarity judging with LLM
 * - Execution tracing (tool calls, resources, tokens, timing)
 *
 * @example
 * ```typescript
 * import { createEvalAgent, describeIfConfigured } from "@mcp-use/evals";
 *
 * describeIfConfigured("Weather Server", () => {
 *   let agent: EvalAgent;
 *
 *   beforeAll(async () => {
 *     agent = await createEvalAgent({ servers: ["weather"] });
 *   });
 *
 *   it("gets weather data", async () => {
 *     const result = await agent.run("What's the weather in SF?");
 *     expect(result).toHaveUsedTool("get_weather");
 *     expect(result).toHaveOutputContaining("sunny");
 *   });
 *
 *   afterAll(() => agent.cleanup());
 * });
 * ```
 */

import "./runtime/matchers.js";

export { createEvalAgent } from "./runtime/createEvalAgent.js";
export { describeIfConfigured } from "./runtime/describeIfConfigured.js";
export { judge } from "./runtime/judge.js";

export type {
  EvalAgent,
  EvalResult,
  ResourceAccess,
  TokenUsage,
  ToolCall,
  ToolCallError,
  ToolCallOutput,
} from "./runtime/types.js";
