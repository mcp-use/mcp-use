import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { encode as encodeToon } from "@toon-format/toon";
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
- **REQUIRED**: Generate EXACTLY 3-5 tests per tool with DIFFERENT parameter combinations

### Indirect Tests  
- **Purpose**: Test natural language understanding and intent inference
- **Prompt style**: Natural conversational requests WITHOUT mentioning tool names
- **Assertions**: Use judgeExpectation for behavioral validation (NOT expectedToolCall)
- **Example**: "Show me completed work" → judgeExpectation: "Agent retrieves and displays completed tasks"
- **Why**: LLMs may interpret requests differently (completed = done? in_progress today?), judge validates behavior not exact params
- **REQUIRED**: Generate EXACTLY 3-5 tests per tool with VARIED phrasings
- **CRITICAL**: These must be ACTION requests, NOT questions about how to use the tool

### Negative Tests
- **Purpose**: Verify tool is NOT called when inappropriate
- **Prompt style**: Clearly unrelated requests or questions ABOUT the tool (not asking to USE it)
- **Assertions**: expectNotUsed: true
- **Example**: "What is the weather?" for a task management tool
- **Example**: "How do I use this tool?" or "What does this tool do?"
- **Avoid**: Ambiguous prompts that could reasonably trigger the tool
- **REQUIRED**: Generate EXACTLY 2-3 tests per tool

### Error Tests
- **Purpose**: Verify graceful error handling with invalid/missing required parameters
- **Prompt style**: Explicitly request invalid operations or omit required fields
- **Assertions**: expectFailure: true
- **Example**: "Create a task without any title or description" (if title is required)
- **Example**: "Delete a task without providing an ID"
- **Note**: Don't rely on LLM to "fail to provide" - explicitly instruct invalid usage
- **REQUIRED**: Generate EXACTLY 2-3 tests per tool with DIFFERENT types of errors

## Output Format
Return a VALID JSON object (not JavaScript). Follow this structure EXACTLY:

{
  "tools": [
    {
      "name": "tool_name",
      "tests": [
        {
          "category": "direct|indirect|negative|error",
          "prompt": "The user prompt to test",
          "expectedToolCall": {
            "name": "tool_name",
            "input": { "param1": "value1", "param2": "value2" }
          },
          "expectFailure": false,
          "expectNotUsed": false,
          "judgeExpectation": "Behavioral assertion"
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

### CRITICAL JSON FORMATTING RULES:

1. **expectedToolCall.input MUST be an object {}, NEVER a string**
   ❌ WRONG: "input": "some string"
   ❌ WRONG: "input": "param1=value1"
   ✅ CORRECT: "input": { "param1": "value1", "param2": "value2" }
   ✅ CORRECT: "input": {} (for tools with no parameters)

2. **Field usage by category:**
   - **direct**: Include expectedToolCall with exact input object
   - **indirect**: Include judgeExpectation, MAY include expectedToolCall if tool is expected
   - **negative**: Set expectNotUsed: true, DO NOT include expectedToolCall
   - **error**: Set expectFailure: true, MAY include expectedToolCall with invalid input

3. **Do not include null or undefined fields** - simply omit fields that don't apply

4. **Ensure valid JSON** - use double quotes, proper escaping, no trailing commas

## Critical Guidelines

1. **For indirect tests**: Use judgeExpectation instead of expectedToolCall (LLMs interpret naturally, not literally)
2. **For negative tests**: Make prompts obviously wrong/unrelated, not ambiguous edge cases
3. **For error tests**: Explicitly instruct invalid usage, don't rely on LLM failing to infer
4. **Parameter specificity**: Only include expectedToolCall when parameters are explicitly stated in prompt
5. **Use null for omitted fields**: Do not include fields like expectedToolCall if not applicable

## MANDATORY Test Coverage Requirements

YOU MUST generate comprehensive test coverage for EVERY tool following these EXACT requirements:

### For EACH tool, generate:
1. **Direct tests**: MINIMUM 3, MAXIMUM 5 tests
   - Each test MUST use different parameter values or combinations
   - Test different scenarios and edge cases within valid usage
   
2. **Indirect tests**: MINIMUM 3, MAXIMUM 5 tests
   - Each test MUST use different natural language phrasing
   - These MUST be ACTION requests (e.g., "Show me...", "Get the...", "Find...")
   - NEVER generate questions ABOUT the tool (e.g., "How do I...?", "What does...?")
   
3. **Negative tests**: MINIMUM 2, MAXIMUM 3 tests
   - Prompts that are clearly unrelated to the tool's purpose
   - Questions ABOUT the tool (e.g., "How does X work?", "What is X?")
   - Ensure these prompts should NOT trigger the tool
   
4. **Error tests**: MINIMUM 2, MAXIMUM 3 tests
   - Each test MUST test a DIFFERENT error condition
   - Examples: missing required field, invalid value type, out of range value
   - Be specific about which requirement is violated

### Validation Rules:
- Count your tests for each category before submitting
- If any category has fewer than the minimum, ADD MORE TESTS
- If any test in indirect category asks "How" or "What is", MOVE IT to negative tests
- Each tool MUST have AT LEAST 10 total tests (3+3+2+2)

DO NOT SKIP ANY TOOLS. DO NOT GENERATE FEWER TESTS THAN THE MINIMUM.
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
  /** Use TOON format for schema serialization (default: true) */
  useToon?: boolean;
  /** Enable extended thinking/reasoning mode (for compatible models) */
  thinking?: boolean;
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

    const config: Record<string, unknown> = {
      model: options.model,
      openAIApiKey: apiKey,
      configuration: options.baseUrl ? { baseURL: options.baseUrl } : undefined,
    };

    // Enable extended thinking for reasoning models (o1, o3 series)
    if (options.thinking) {
      config.temperature = undefined;
    } else {
      config.temperature = 0.7;
    }

    return new ChatOpenAI(config);
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    throw new PlannerError("ANTHROPIC_API_KEY is required for planner");
  }

  const config: Record<string, unknown> = {
    model: options.model,
    anthropicApiKey: anthropicKey,
  };

  // Enable extended thinking for Claude with thinking parameter
  if (options.thinking) {
    // Anthropic extended thinking via model parameters
    config.modelKwargs = {
      thinking: { type: "enabled", budget_tokens: 10000 },
    };
    config.temperature = undefined;
  } else {
    config.temperature = 0.7;
  }

  return new ChatAnthropic(config);
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
  const useToon = options.useToon ?? true;

  for (const server of schemas) {
    // Serialize schemas based on format preference
    const toolsContent = useToon
      ? `\`\`\`toon\n${encodeToon(server.tools)}\n\`\`\``
      : JSON.stringify(server.tools, null, 2);

    const resourcesContent = useToon
      ? `\`\`\`toon\n${encodeToon(server.resources)}\n\`\`\``
      : JSON.stringify(server.resources, null, 2);

    const userMessage = `Generate a test plan for the following MCP server:

Server: ${server.name}

Tools:
${toolsContent}

Resources:
${resourcesContent}
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
