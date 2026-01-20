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
You are a test planner for MCP agent evaluations.

## CRITICAL RULES

### 1. Use EXACT Parameter Names from Schema
Look at the inputSchema.properties for each tool - use those exact property names.
- WRONG: { "status": "done" } if schema has "newStatus"
- RIGHT: { "newStatus": "done" } matching schema exactly

### 2. Judge Expectations Must Be Behavioral (Not Exact Output)
Keep judge expectations simple and behavioral:
- BAD: "All returned tasks have status 'todo' and counts reflect filtered view"
- GOOD: "Agent filters and shows task list"
- BAD: "Returns exactly {success: true, message: 'Done'}"
- GOOD: "Agent confirms the action completed"

### 3. Negative Tests Must Be TRULY Unrelated
Use completely different domains - weather, math, jokes, geography:
- BAD: "Explain what a Kanban board is" (still related)
- BAD: "What does listTasks do?" (asks about the tool)
- GOOD: "What's the capital of France?"
- GOOD: "Calculate 15% of 80"
- GOOD: "Tell me a joke"

### 4. Skip Flaky Error Tests
LLMs often fix invalid inputs. Only include error tests for:
- Missing REQUIRED parameters (clearly stated in prompt)
- Use fake IDs like "does-not-exist" for not-found errors
- Do NOT test: empty strings, boundary values (LLM will fix)

## Test Categories (per tool: 4-5 direct, 3-4 indirect, 2 negative, 1-2 error)

### Direct Tests
- Prompt: "Use [tool] with [exactParamName]=value"
- Include: expectedToolCall.input with EXACT param names from schema

### Indirect Tests
- Prompt: Natural language action (no tool names)
- Include: expectedToolCall.name + judgeExpectation

### Negative Tests
- Prompt: COMPLETELY unrelated domain
- Include: expectNotUsed: true

### Error Tests (optional)
- Prompt: Missing required param or non-existent ID
- Include: expectFailure: true

## Output Format

{
  "tools": [{
    "name": "tool_name",
    "tests": [{
      "category": "direct",
      "prompt": "Use tool_name with exactParam=value",
      "description": "basic usage",
      "expectedToolCall": { "name": "tool_name", "input": { "exactParam": "value" } },
      "judgeExpectation": "Agent completes action"
    }]
  }],
  "resources": []
}

## Rules
- Parameter names: Use EXACT names from inputSchema.properties
- Tool names: Use exact name, no prefixes like "functions."
- expectedToolCall.input: object {}, never string
- judgeExpectation: Simple behavioral check
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
  /** Enable exploratory mode where agent tests tools before generating plans (default: false) */
  explore?: boolean;
  /** Path to eval config file (required for exploratory mode) */
  configPath?: string;
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
  const explore = options.explore ?? false;

  // Use exploratory mode if enabled
  if (explore) {
    if (!options.configPath) {
      throw new PlannerError(
        "configPath is required when explore mode is enabled"
      );
    }

    // Import the exploratory planner
    const { createExploratoryTestPlan } =
      await import("./createPlannerAgent.js");

    const plans: TestPlan[] = [];
    for (const schema of schemas) {
      const plan = await createExploratoryTestPlan(
        schema,
        options.configPath,
        options
      );
      plans.push(plan);
    }
    return plans;
  }

  // Original static schema approach
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
