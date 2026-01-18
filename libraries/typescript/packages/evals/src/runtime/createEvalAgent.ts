import { MCPAgent, MCPClient } from "mcp-use";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { EvalConfigError } from "../shared/errors.js";
import { loadEvalConfig } from "./loadEvalConfig.js";
import { EvalAgent } from "./EvalAgent.js";
import type { AgentConfig, EvalConfig } from "./config.js";
import { TokenTrackingCallback } from "./tokenUsage.js";
import type { TokenUsage } from "./types.js";

/**
 * Options for creating an evaluation agent.
 */
export interface CreateEvalAgentOptions {
  /** Key of the agent config to use for running evals (from eval.config.json) */
  runAgent?: string;
  /** Key of the agent config to use for judging results (from eval.config.json) */
  judgeAgent?: string;
  /** Array of server keys to connect to (defaults to all servers in config) */
  servers?: string[];
  /** Server lifecycle management: "suite" (once per test suite) or "test" (per test) */
  serverLifecycle?: "suite" | "test";
  /** Path to eval config file (defaults to eval.config.json) */
  configPath?: string;
}

/**
 * Resolve an agent configuration by key from the eval config.
 *
 * @param config - The loaded eval configuration
 * @param key - Agent configuration key to look up
 * @returns The resolved agent configuration
 * @throws {EvalConfigError} If agent key not found in config
 * @internal
 */
function resolveAgentConfig(config: EvalConfig, key: string): AgentConfig {
  const agentConfig = config.agents[key];
  if (!agentConfig) {
    throw new EvalConfigError(`Agent "${key}" not found in eval config`);
  }
  return agentConfig;
}

/**
 * Create an LLM model instance from agent configuration.
 * Supports OpenAI-compatible and Anthropic providers.
 *
 * @param agentConfig - Agent configuration with provider and model details
 * @returns Configured LangChain chat model instance
 * @throws {EvalConfigError} If provider is unsupported or API key is missing
 * @internal
 */
function createModel(agentConfig: AgentConfig) {
  if (agentConfig.provider === "openai") {
    const apiKey =
      process.env.OPENAI_API_KEY || (agentConfig.baseUrl ? "local" : undefined);

    if (!apiKey) {
      throw new EvalConfigError(
        "OPENAI_API_KEY is required for OpenAI-compatible providers"
      );
    }

    return new ChatOpenAI({
      model: agentConfig.model,
      openAIApiKey: apiKey,
      configuration: agentConfig.baseUrl
        ? { baseURL: agentConfig.baseUrl }
        : undefined,
    });
  }

  if (agentConfig.provider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new EvalConfigError(
        "ANTHROPIC_API_KEY is required for Anthropic providers"
      );
    }

    return new ChatAnthropic({
      model: agentConfig.model,
      anthropicApiKey: apiKey,
    });
  }

  throw new EvalConfigError(`Unsupported provider: ${agentConfig.provider}`);
}

/**
 * Create an evaluation agent for testing MCP servers.
 *
 * Creates and configures an MCPAgent with LangChain LLM integration,
 * connects to specified MCP servers, and provides a test-friendly interface
 * with execution tracing, tool call monitoring, and resource tracking.
 *
 * @param options - Configuration options for the eval agent
 * @returns Configured EvalAgent instance ready for test execution
 * @throws {EvalConfigError} If configuration is invalid or servers fail to connect
 *
 * @example
 * ```typescript
 * // Create agent with default config
 * const agent = await createEvalAgent();
 *
 * // Create agent with specific model and servers
 * const agent = await createEvalAgent({
 *   runAgent: "sonnet",
 *   servers: ["weather", "calendar"],
 *   serverLifecycle: "test"
 * });
 *
 * // Run tests
 * const result = await agent.run("What's the weather?");
 * expect(result).toHaveUsedTool("get_weather");
 *
 * // Clean up
 * await agent.cleanup();
 * ```
 */
export async function createEvalAgent(
  options: CreateEvalAgentOptions = {}
): Promise<EvalAgent> {
  const config = await loadEvalConfig(options.configPath);
  const runAgentKey = options.runAgent ?? config.default.runAgent;
  const runAgentConfig = resolveAgentConfig(config, runAgentKey);

  const llm = createModel(runAgentConfig);

  const serverKeys = options.servers ?? Object.keys(config.servers);
  const servers: Record<string, unknown> = {};
  for (const key of serverKeys) {
    const serverConfig = config.servers[key];
    if (!serverConfig) {
      throw new EvalConfigError(`Server "${key}" not found in eval config`);
    }
    servers[key] = serverConfig;
  }

  const client = new MCPClient({
    mcpServers: servers,
  });

  try {
    await client.createAllSessions();

    const usage: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };

    // Build agent options with optional additionalInstructions from config
    const agentOptions: any = {
      client,
      llm,
      maxSteps: 10,
      memoryEnabled: true,
      autoInitialize: true,
      callbacks: [new TokenTrackingCallback(usage)],
    };

    // Add additionalInstructions if provided in config
    if (config.defaults.additionalInstructions) {
      agentOptions.additionalInstructions =
        config.defaults.additionalInstructions;
    }

    const agent = new MCPAgent(agentOptions);

    return new EvalAgent(agent, client, {
      serverLifecycle:
        options.serverLifecycle ?? config.defaults.serverLifecycle,
      usage,
    });
  } catch (error) {
    await client.closeAllSessions();
    throw error;
  }
}
