import { MCPAgent, MCPClient } from "mcp-use";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { PlannerError } from "../shared/errors.js";
import type { ServerSchema, ToolSchema } from "./inspectServers.js";
import type { TestPlan } from "./planSchema.js";
import type { PlannerOptions } from "./planTests.js";

/**
 * Schema for tool exploration summary.
 * Captures key findings from exploring a single tool.
 */
const ToolExplorationSummarySchema = z.object({
  toolName: z.string(),
  description: z.string(),
  /** Actual parameter names from tool schema - CRITICAL for correct test generation */
  parameterNames: z.array(z.string()),
  /** Required parameters that must be provided */
  requiredParams: z.array(z.string()),
  sampleInputs: z.array(
    z.object({
      input: z.record(z.string(), z.unknown()),
      output: z.string(),
      success: z.boolean(),
    })
  ),
  errorCases: z.array(
    z.object({
      input: z.record(z.string(), z.unknown()),
      errorMessage: z.string(),
    })
  ),
  notes: z.string().optional(),
});

type ToolExplorationSummary = z.infer<typeof ToolExplorationSummarySchema>;

/**
 * System prompt for Phase 1: Tool Exploration.
 * Agent explores ONE tool and submits a structured summary.
 */
const EXPLORATION_SYSTEM_PROMPT = `
You are exploring an MCP tool to understand its behavior.

## CRITICAL: Parameter Names
When you submit your exploration summary, you MUST include:
- parameterNames: The EXACT parameter names from the tool schema (e.g., ["taskId", "newStatus"] NOT ["taskId", "status"])
- requiredParams: Which parameters are required

Look at the tool schema provided - use the EXACT property names, not synonyms.

## Workflow
1. Note the exact parameter names from the schema
2. Make 1-2 sample calls with valid inputs
3. Make 1 call with invalid input to see error behavior
4. Submit structured summary with correct parameter names

Be efficient - submit immediately after gathering findings.
`;

/**
 * System prompt for Phase 2: Test Plan Generation.
 * Takes exploration summaries and generates comprehensive test plan.
 */
const PLANNING_SYSTEM_PROMPT = `
You are generating a test plan from tool exploration summaries.

## CRITICAL RULES

### 1. Use EXACT Parameter Names
Each tool summary includes parameterNames array - use EXACTLY those names.
- WRONG: { "status": "done" } when param is "newStatus"
- RIGHT: { "newStatus": "done" } matching the schema

### 2. Judge Expectations Must Be Behavioral (Not Exact Output)
- BAD: "All returned tasks have status 'todo' and counts reflect filtered view"
- GOOD: "Agent filters and shows task list"
- BAD: "Agent returns success true and message 'Task deleted'"
- GOOD: "Agent confirms deletion"

### 3. Negative Tests Must Be TRULY Unrelated
Use completely different domains - weather, math, jokes, recipes:
- BAD: "Explain what a Kanban board is" (still related to the tool domain)
- BAD: "What does listTasks do?" (asks about the tool)
- GOOD: "What's the capital of France?"
- GOOD: "Tell me a joke about cats"
- GOOD: "Calculate 15% of 80"

### 4. Avoid Hardcoded IDs From Exploration
IDs created during exploration won't exist at test time.
- BAD: "Delete task-1768845107063-abc123"
- GOOD: "List all tasks" (uses no specific ID)
- GOOD: "Create a new task called 'Test'" (creates fresh)
- If ID is needed, use obviously fake: "task-does-not-exist" for error tests

### 5. Skip Flaky Error Tests
LLMs often fix invalid inputs. Only include error tests for:
- Missing REQUIRED parameters (LLM can't infer)
- Clearly invalid types the server rejects
- Do NOT test: empty strings, boundary values (LLM will fix)

## Test Categories (per tool: 4-5 direct, 3-4 indirect, 2 negative, 1-2 error)

### Direct Tests
- Prompt: "Use [tool] with [exactParamName]=value"
- Include: expectedToolCall.input with EXACT param names + judgeExpectation

### Indirect Tests  
- Prompt: Natural language action request (no tool names)
- Include: expectedToolCall.name + judgeExpectation

### Negative Tests
- Prompt: COMPLETELY unrelated (different domain entirely)
- Include: expectNotUsed: true + judgeExpectation

### Error Tests (optional, only if reliable)
- Prompt: Missing required param or calling with non-existent ID
- Include: expectFailure: true + judgeExpectation

## Output Format

{
  "tools": [{
    "name": "toolName",
    "tests": [
      {
        "category": "direct",
        "prompt": "Use toolName with exactParamName=value",
        "description": "basic usage",
        "expectedToolCall": { "name": "toolName", "input": { "exactParamName": "value" } },
        "judgeExpectation": "Agent completes the action"
      },
      {
        "category": "indirect",
        "prompt": "Natural language request",
        "description": "infers correct tool",
        "expectedToolCall": { "name": "toolName" },
        "judgeExpectation": "Agent uses tool appropriately"
      },
      {
        "category": "negative",
        "prompt": "What's 25 times 4?",
        "description": "unrelated math question",
        "expectNotUsed": true,
        "judgeExpectation": "Agent answers without using tool"
      }
    ]
  }],
  "resources": []
}
`;

/**
 * Create a submit_exploration tool for capturing tool exploration summary.
 */
function createSubmitExplorationTool(
  toolName: string,
  capturedSummary: { summary: ToolExplorationSummary | null }
): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: "submit_exploration",
    description: `Submit your exploration summary for the ${toolName} tool. Call this after you have explored the tool behavior.`,
    schema: ToolExplorationSummarySchema,
    func: async (summary: ToolExplorationSummary) => {
      const validated = ToolExplorationSummarySchema.parse(summary);
      capturedSummary.summary = validated;
      return `Exploration summary for ${toolName} submitted successfully!`;
    },
  });
}

/**
 * Create LLM instance from options.
 */
function createLLM(options: PlannerOptions) {
  return options.provider === "openai"
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
}

/**
 * Phase 1: Explore a single tool and return structured summary.
 * Uses a fresh agent context per tool to avoid context accumulation.
 */
async function exploreTool(
  tool: ToolSchema,
  client: MCPClient,
  options: PlannerOptions
): Promise<ToolExplorationSummary> {
  const llm = createLLM(options);

  const capturedSummary: { summary: ToolExplorationSummary | null } = {
    summary: null,
  };
  const submitTool = createSubmitExplorationTool(tool.name, capturedSummary);

  const agent = new MCPAgent({
    llm,
    client,
    maxSteps: 10, // Limited steps per tool
    memoryEnabled: false,
    autoInitialize: false,
    additionalTools: [submitTool],
    systemPrompt: EXPLORATION_SYSTEM_PROMPT,
  });

  // Extract parameter names from tool schema
  const parameterNames = Object.keys(tool.inputSchema.properties || {});
  const requiredParams = tool.inputSchema.required || [];

  try {
    await agent.initialize();

    const prompt = `Explore the "${tool.name}" tool.

## Tool Schema
${JSON.stringify(tool, null, 2)}

## IMPORTANT: Parameter Names
The EXACT parameter names are: ${JSON.stringify(parameterNames)}
Required parameters: ${JSON.stringify(requiredParams)}

You MUST include these exact names in your submit_exploration call.

## Instructions
1. Note the exact parameter names above
2. Make 1-2 sample calls with valid inputs
3. Make 1 call with invalid input to see error behavior
4. Call submit_exploration with parameterNames=${JSON.stringify(parameterNames)} and requiredParams=${JSON.stringify(requiredParams)}

Start now!`;

    await agent.run({ prompt, maxSteps: 10 });

    if (!capturedSummary.summary) {
      // If agent didn't submit, create a basic summary from schema
      return {
        toolName: tool.name,
        description: tool.description || "No description",
        parameterNames,
        requiredParams,
        sampleInputs: [],
        errorCases: [],
        notes: "Exploration incomplete - using schema only",
      };
    }

    // Ensure parameter names are correct even if agent got them wrong
    return {
      ...capturedSummary.summary,
      parameterNames,
      requiredParams,
    };
  } finally {
    await agent.close();
  }
}

/**
 * Phase 2: Generate test plan from exploration summaries.
 * Uses LLM calls with self-correction: validates output and retries with error feedback.
 */
async function generatePlanFromSummaries(
  serverName: string,
  summaries: ToolExplorationSummary[],
  resources: ServerSchema["resources"],
  options: PlannerOptions
): Promise<TestPlan> {
  const llm = createLLM(options);
  const MAX_RETRIES = 3;

  // Compact the summaries for the prompt - emphasize parameter names
  const summaryText = summaries
    .map(
      (s) => `
## ${s.toolName}
Description: ${s.description}
**EXACT Parameter Names**: ${JSON.stringify(s.parameterNames)} (use these exactly!)
Required: ${JSON.stringify(s.requiredParams)}
Sample inputs: ${JSON.stringify(s.sampleInputs.slice(0, 2))}
Error cases: ${JSON.stringify(s.errorCases.slice(0, 2))}
${s.notes ? `Notes: ${s.notes}` : ""}`
    )
    .join("\n");

  const resourceText =
    resources.length > 0
      ? `\n\nResources:\n${resources.map((r) => `- ${r.name}: ${r.description || "No description"}`).join("\n")}`
      : "";

  const userPrompt = `Generate a comprehensive test plan for the "${serverName}" server.

## Tool Exploration Summaries
${summaryText}
${resourceText}

Generate the test plan as a JSON object following the TestPlan schema.
Return ONLY valid JSON, no markdown code fences.`;

  // Import validation utilities
  const { extractPlannerJson } = await import("./planValidation.js");
  const { TestPlanSchema } = await import("./planSchema.js");

  // Build conversation for potential retries
  const messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [
    { role: "system", content: PLANNING_SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ];

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`  📝 Generating plan (attempt ${attempt}/${MAX_RETRIES})...`);

    const response = await llm.invoke(messages);
    const content = String(response.content ?? "");

    try {
      // Extract and validate JSON
      const data = extractPlannerJson(content);
      const parsed = TestPlanSchema.safeParse(data);

      if (parsed.success) {
        console.log(`  ✅ Plan validated successfully!`);
        return {
          server: serverName,
          tools: parsed.data.tools,
          resources: parsed.data.resources,
        };
      }

      // Validation failed - format errors for retry
      const errors = parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }));

      console.log(
        `  ⚠️ Validation failed with ${errors.length} errors, asking LLM to fix...`
      );

      // Add assistant response and error feedback to conversation
      messages.push({ role: "assistant", content });
      messages.push({
        role: "user",
        content: `Your JSON has validation errors. Please fix them and return the corrected JSON only.

## Validation Errors:
${errors.map((err) => `- ${err.path}: ${err.message}`).join("\n")}

## Reminder of required structure per test:
- direct/indirect tests MUST have: expectedToolCall: { name: "toolName", input: {...} }
- negative tests MUST have: expectNotUsed: true
- error tests MUST have: expectFailure: true
- ALL tests should have: judgeExpectation for probabilistic validation

Return the FIXED JSON only, no explanation.`,
      });
    } catch (error) {
      // JSON parsing/extraction failed
      console.log(`  ⚠️ JSON extraction failed, asking LLM to fix...`);

      messages.push({ role: "assistant", content });
      messages.push({
        role: "user",
        content: `Your response could not be parsed as JSON. Error: ${error instanceof Error ? error.message : String(error)}

Please return ONLY valid JSON with no markdown code fences or extra text.`,
      });
    }
  }

  throw new PlannerError(
    `Failed to generate valid test plan after ${MAX_RETRIES} attempts`
  );
}

/**
 * Create an exploratory test plan using Two-Phase Architecture.
 *
 * Phase 1: Explore each tool individually (fresh context per tool)
 * Phase 2: Generate test plan from exploration summaries
 *
 * This architecture keeps context bounded regardless of tool count.
 *
 * @param schema - Server schema with tools and resources
 * @param evalConfigPath - Path to eval.config.json for server connections
 * @param options - Planner configuration
 * @returns Test plan generated through exploration
 * @throws {PlannerError} If exploration or planning fails
 */
export async function createExploratoryTestPlan(
  schema: ServerSchema,
  evalConfigPath: string,
  options: PlannerOptions
): Promise<TestPlan> {
  // Load config and create client
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

  try {
    // Phase 1: Explore tools in parallel with concurrency limit
    const CONCURRENCY_LIMIT = 3; // Limit parallel explorations to avoid rate limits
    console.log(
      `📊 Phase 1: Exploring ${schema.tools.length} tools (${CONCURRENCY_LIMIT} in parallel)...`
    );

    // Helper to explore a tool with error handling
    const exploreWithFallback = async (
      tool: ToolSchema
    ): Promise<ToolExplorationSummary> => {
      console.log(`  🔍 Exploring: ${tool.name}`);
      try {
        const summary = await exploreTool(tool, client, options);
        console.log(
          `  ✅ ${tool.name}: ${summary.sampleInputs.length} samples, ${summary.errorCases.length} errors`
        );
        return summary;
      } catch (error) {
        console.log(`  ⚠️ ${tool.name}: exploration failed, using schema only`);
        // Extract parameter names from schema for fallback
        const parameterNames = Object.keys(tool.inputSchema.properties || {});
        const requiredParams = tool.inputSchema.required || [];
        return {
          toolName: tool.name,
          description: tool.description || "No description",
          parameterNames,
          requiredParams,
          sampleInputs: [],
          errorCases: [],
          notes: `Exploration failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    };

    // Process tools in batches with concurrency limit
    const summaries: ToolExplorationSummary[] = [];
    for (let i = 0; i < schema.tools.length; i += CONCURRENCY_LIMIT) {
      const batch = schema.tools.slice(i, i + CONCURRENCY_LIMIT);
      const batchResults = await Promise.all(
        batch.map((tool) => exploreWithFallback(tool))
      );
      summaries.push(...batchResults);
    }

    // Phase 2: Generate test plan from summaries
    console.log(`\n📝 Phase 2: Generating test plan from summaries...`);
    const plan = await generatePlanFromSummaries(
      schema.name,
      summaries,
      schema.resources,
      options
    );

    console.log(
      `✅ Generated ${plan.tools.length} tool test plans, ${plan.resources.length} resource test plans`
    );

    return plan;
  } finally {
    await client.closeAllSessions();
  }
}
