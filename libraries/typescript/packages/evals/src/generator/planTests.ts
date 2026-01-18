import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { PlannerError } from "../shared/errors.js";
import { extractPlannerJson, validatePlan } from "./planValidation.js";
import type { ServerSchema } from "./inspectServers.js";
import type { TestPlan } from "./planSchema.js";

/**
 * System prompt for the test planner LLM.
 * Instructs the model on how to generate comprehensive test plans
 * for MCP tools and resources using the eval framework's matchers.
 *
 * @internal
 */
const PLANNER_SYSTEM_PROMPT = `
You are a test planning assistant for MCP (Model Context Protocol) agent evaluations.

Your task is to generate comprehensive test plans for MCP tools and resources.

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
Use judge(output, expectation) for complex behavioral validation.

Generated code:
const judgeResult = await judge(result.output, "expectation");
expect(judgeResult.score).toBeGreaterThan(0.7);

## Test Categories & Best Practices

### Direct Tests
- **Purpose**: Verify tool is called with explicit, unambiguous instructions
- **Prompt style**: "Use [tool] with [exact parameters]", "Call [tool] to [specific action]"
- **Assertions**: Use expectedToolCall with exact input parameters
- **Example**: "List all tasks with status 'done'" → expectedToolCall: {"status": "done"}

### Indirect Tests  
- **Purpose**: Test natural language understanding and intent inference
- **Prompt style**: Natural conversational requests without mentioning tool names
- **Assertions**: Use judgeExpectation for behavioral validation (NOT expectedToolCall)
- **Example**: "Show me completed work" → judgeExpectation: "Agent retrieves and displays completed tasks"
- **Why**: LLMs may interpret requests differently (completed = done? in_progress today?), judge validates behavior not exact params

### Negative Tests
- **Purpose**: Verify tool is NOT called when inappropriate
- **Prompt style**: Clearly unrelated requests or questions about the tool (not asking to use it)
- **Assertions**: expectNotUsed: true
- **Example**: "What is the weather?" for a task management tool
- **Avoid**: Ambiguous prompts that could reasonably trigger the tool

### Error Tests
- **Purpose**: Verify graceful error handling with invalid/missing required parameters
- **Prompt style**: Explicitly request invalid operations or omit required fields
- **Assertions**: expectFailure: true
- **Example**: "Create a task without any title or description" (if title is required)
- **Note**: Don't rely on LLM to "fail to provide" - explicitly instruct invalid usage

## Output Format
Return a VALID JSON object (not JavaScript):

{
  "tools": [
    {
      "name": "tool_name",
      "tests": [
        {
          "category": "direct|indirect|negative|error",
          "prompt": "The user prompt to test",
          "expectedToolCall": { "name": "tool_name", "input": { ... } },  // ONLY for direct tests
          "expectFailure": false,
          "expectNotUsed": false,
          "judgeExpectation": "Behavioral assertion"  // PREFER for indirect tests
        }
      ]
    }
  ],
  "resources": [
    {
      "name": "resource_name",
      "tests": [
        {
          "category": "direct|indirect|negative",
          "prompt": "The user prompt to test",
          "expectNotUsed": false,
          "judgeExpectation": "Optional: semantic assertion"
        }
      ]
    }
  ]
}

## Critical Guidelines

1. **For indirect tests**: Use judgeExpectation instead of expectedToolCall (LLMs interpret naturally, not literally)
2. **For negative tests**: Make prompts obviously wrong/unrelated, not ambiguous edge cases
3. **For error tests**: Explicitly instruct invalid usage, don't rely on LLM failing to infer
4. **Parameter specificity**: Only include expectedToolCall when parameters are explicitly stated in prompt
5. **Use null for omitted fields**: Do not include fields like expectedToolCall if not applicable

Generate 3-5 tests per category with varied complexity and clear intent.
`;

/**
 * Options for configuring the test planner LLM.
 */
export interface PlannerOptions {
  /** LLM provider (openai or anthropic) */
  provider: "openai" | "anthropic";
  /** Model identifier to use for planning */
  model: string;
  /** Optional base URL for OpenAI-compatible providers */
  baseUrl?: string;
}

/**
 * Create a planner LLM instance from options.
 *
 * @param options - Planner configuration
 * @returns Configured LangChain chat model
 * @throws {PlannerError} If API key is missing or provider unsupported
 * @internal
 */
function createPlanner(options: PlannerOptions) {
  if (options.provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new PlannerError("OPENAI_API_KEY is required for planner");
    }
    return new ChatOpenAI({
      model: options.model,
      openAIApiKey: apiKey,
      configuration: options.baseUrl ? { baseURL: options.baseUrl } : undefined,
      temperature: 0.7,
    });
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    throw new PlannerError("ANTHROPIC_API_KEY is required for planner");
  }
  return new ChatAnthropic({
    model: options.model,
    anthropicApiKey: anthropicKey,
    temperature: 0.7,
  });
}

/**
 * Generate test plans for MCP servers using an LLM planner.
 *
 * Takes server schemas (tools and resources) and uses an LLM to generate
 * comprehensive test plans with various test categories (direct, indirect,
 * negative, error) and appropriate assertions.
 *
 * @param schemas - Array of server schemas from inspectServers()
 * @param options - Planner LLM configuration
 * @returns Array of validated test plans, one per server
 * @throws {PlannerError} If LLM returns invalid JSON or plan fails validation
 *
 * @example
 * ```typescript
 * const schemas = await inspectServers({ servers: ["weather"] });
 * const plans = await planTests(schemas, {
 *   provider: "anthropic",
 *   model: "claude-3-5-sonnet-20241022"
 * });
 * console.log(plans[0].tools[0].tests); // Generated test cases
 * ```
 */
export async function planTests(
  schemas: ServerSchema[],
  options: PlannerOptions
): Promise<TestPlan[]> {
  const llm = createPlanner(options);
  const plans: TestPlan[] = [];

  for (const server of schemas) {
    const userMessage = `Generate a test plan for the following MCP server:

Server: ${server.name}

Tools:
${JSON.stringify(server.tools, null, 2)}

Resources:
${JSON.stringify(server.resources, null, 2)}
`;

    const response = await llm.invoke([
      { role: "system", content: PLANNER_SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ]);

    const content = String(response.content ?? "");
    const data = extractPlannerJson(content);
    const validated = validatePlan(data);

    plans.push({
      server: server.name,
      tools: validated.tools,
      resources: validated.resources,
    });
  }

  return plans;
}
