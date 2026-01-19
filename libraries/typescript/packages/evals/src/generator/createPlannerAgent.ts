import { MCPAgent, MCPClient } from "mcp-use";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { PlannerError } from "../shared/errors.js";
import type { ServerSchema } from "./inspectServers.js";
import type { TestPlan } from "./planSchema.js";
import { TestPlanSchema } from "./planSchema.js";
import type { PlannerOptions } from "./planTests.js";

/**
 * System prompt for the exploratory planner agent.
 * Instructs the agent to test tools and generate comprehensive test plans.
 */
const EXPLORATORY_PLANNER_SYSTEM_PROMPT = `
You are a test planning assistant for MCP (Model Context Protocol) agent evaluations.

Your task is to EXPLORE MCP tools by making sample calls, then generate comprehensive test plans.

## Your Workflow

1. **EXPLORE TOOLS**: For each available tool, make 1-2 sample calls with typical inputs to understand:
   - What parameters the tool expects
   - What outputs it returns
   - How it handles edge cases
   - What errors it produces for invalid inputs

2. **GENERATE TEST PLAN**: After exploring, call the submit_test_plan tool with your comprehensive test plan.

## Test Categories

### Direct Tests (3-5 per tool)
- Purpose: Verify tool is called with explicit, unambiguous instructions
- Prompt style: "Use [tool] with [exact parameters]", "Call [tool] to [specific action]"
- Use the REAL outputs you observed during exploration
- REQUIRED: Generate 3-5 tests with DIFFERENT parameter combinations

### Indirect Tests (3-5 per tool)
- Purpose: Test natural language understanding without mentioning tool names
- Prompt style: Natural conversational requests (e.g., "Show me...", "Get the...")
- Use judgeExpectation for behavioral validation (NOT exact outputs)
- REQUIRED: Generate 3-5 tests with VARIED natural phrasings
- CRITICAL: These must be ACTION requests, NOT questions about the tool

### Negative Tests (2-3 per tool)
- Purpose: Verify tool is NOT called when inappropriate
- Prompt style: Clearly unrelated requests or questions ABOUT the tool
- Example: "What is the weather?" or "How do I use this tool?"
- REQUIRED: Generate 2-3 tests

### Error Tests (2-3 per tool)
- Purpose: Verify graceful error handling
- Based on errors you observed during exploration
- Test missing required fields, invalid values, etc.
- REQUIRED: Generate 2-3 tests with DIFFERENT error conditions

## Critical Guidelines

1. **Explore first, plan second**: Make sample calls to understand real behavior
2. **Use real data**: Base expectedToolCall on actual inputs/outputs you observed
3. **Test comprehensively**: Each tool needs at least 10 tests total (3+3+2+2 minimum)
4. **Submit once**: Call submit_test_plan only AFTER exploring all tools

## Available Testing Capabilities

### Exact Matchers (for structural/precise assertions)
- toHaveUsedTool(toolName) - verify a tool was called
- toHaveToolCallCount(toolName, count) - verify exact number of calls
- toHaveToolCallWith(toolName, input) - verify specific input (partial match)
- toHaveToolCallResult(toolName, output) - verify specific output content
- toHaveCalledToolsInOrder(...toolNames) - verify call sequence
- toHaveUsedResource(resourceName) - verify resource access
- toHaveOutputContaining(text) - verify agent output contains text
- toHaveCompletedWithinMs(ms) - verify execution time
- toHaveUsedLessThanTokens(count) - verify token usage
- toHaveFailed() - verify agent failed
- toHaveFailedWith(text) - verify error message contains text
- toHaveToolCallFailed(toolName) - verify tool failure
- toHaveToolCallFailedWith(toolName, text) - verify tool error message

### Semantic Judge (for behavioral/meaning assertions)
Use judge(output, expectation) for complex behavioral validation in indirect tests.

Remember: Explore the tools thoroughly, then submit a complete test plan!
`;

/**
 * Create a submit_test_plan tool that validates and captures the test plan.
 */
function createSubmitTestPlanTool(
  serverName: string,
  capturedPlan: { plan: TestPlan | null }
): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: "submit_test_plan",
    description: `Submit the comprehensive test plan for the ${serverName} server after you have finished exploring all tools. This tool accepts the complete test plan with test cases for all tools and resources.`,
    schema: TestPlanSchema,
    func: async (plan: TestPlan) => {
      // Validate the plan structure
      const validated = TestPlanSchema.parse(plan);

      // Capture the plan for extraction
      capturedPlan.plan = validated;

      return `Test plan submitted successfully! Generated ${validated.tools.length} tool test plans and ${validated.resources.length} resource test plans.`;
    },
  });
}

/**
 * Create an exploratory planner agent that can test MCP tools before generating test plans.
 *
 * @param schema - Server schema with tools and resources
 * @param evalConfigPath - Path to eval.config.json for server connections
 * @param options - Planner configuration
 * @returns Test plan generated through exploration
 * @throws {PlannerError} If agent fails to explore or submit plan
 */
export async function createExploratoryTestPlan(
  schema: ServerSchema,
  evalConfigPath: string,
  options: PlannerOptions
): Promise<TestPlan> {
  // Create LLM for the agent
  const llm =
    options.provider === "openai"
      ? new ChatOpenAI({
          model: options.model,
          openAIApiKey: process.env.OPENAI_API_KEY,
          configuration: options.baseUrl
            ? { baseURL: options.baseUrl }
            : undefined,
          temperature: options.thinking ? undefined : 0.7,
        })
      : new ChatAnthropic({
          model: options.model,
          anthropicApiKey: process.env.ANTHROPIC_API_KEY,
          temperature: options.thinking ? undefined : 0.7,
          ...(options.thinking && {
            modelKwargs: {
              thinking: { type: "enabled", budget_tokens: 10000 },
            },
          }),
        });

  // Create MCP client and connect to the server
  const { loadEvalConfig } = await import("../runtime/loadEvalConfig.js");
  const config = await loadEvalConfig(evalConfigPath);

  const serverConfig = config.servers[schema.name];
  if (!serverConfig) {
    throw new PlannerError(
      `Server "${schema.name}" not found in eval config at ${evalConfigPath}`
    );
  }

  const client = new MCPClient({
    mcpServers: { [schema.name]: serverConfig },
  });

  try {
    await client.createAllSessions();
  } catch (error) {
    await client.closeAllSessions();
    throw new PlannerError(
      `Failed to connect to server "${schema.name}": ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Create the submit_test_plan tool
  const capturedPlan: { plan: TestPlan | null } = { plan: null };
  const submitTestPlanTool = createSubmitTestPlanTool(
    schema.name,
    capturedPlan
  );

  // Create the agent with access to MCP tools AND submit_test_plan
  const agent = new MCPAgent({
    llm,
    client,
    maxSteps: 15, // Limit steps to reduce token usage
    memoryEnabled: false, // Disable memory to reduce context size
    autoInitialize: false,
    additionalTools: [submitTestPlanTool],
    systemPrompt: EXPLORATORY_PLANNER_SYSTEM_PROMPT,
  });

  try {
    await agent.initialize();

    // Prompt the agent to explore and create test plan
    // Keep prompt concise to reduce token usage
    const explorationPrompt = `Generate a comprehensive test plan for the "${schema.name}" server.

Available: ${schema.tools.length} tools${schema.resources.length > 0 ? `, ${schema.resources.length} resources` : ""}

Instructions:
1. Make 1-2 quick sample calls per tool to understand behavior
2. Generate test cases (direct, indirect, negative, error) based on observations
3. Call submit_test_plan with your complete plan

Focus on efficiency - test minimally but plan comprehensively. Start now!`;

    await agent.run({ prompt: explorationPrompt });

    // Check if the plan was captured
    if (!capturedPlan.plan) {
      throw new PlannerError(
        "Agent did not call submit_test_plan. The test plan was not generated."
      );
    }

    // Add server name to the plan
    return {
      ...capturedPlan.plan,
      server: schema.name,
    };
  } finally {
    await agent.close();
    await client.closeAllSessions();
  }
}
