import { z } from "zod";

export const API_VERSION = "mcp-use.com/evals/v1" as const;

const argMatcherSchema: z.ZodType<unknown> = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.literal("any"),
  z.object({ contains: z.string() }),
  z.object({ pattern: z.string() }),
  z.object({ any: z.literal(true), requirePresent: z.literal(true) }),
  z.record(z.string(), z.unknown()),
]);

export const assertRuleSchema: z.ZodType<{
  kind: string;
  path?: string;
  equals?: unknown;
  contains?: string;
  pattern?: string;
  type?: string;
  uri?: string;
  fields?: Record<string, unknown>;
  assert?: unknown[];
}> = z.object({
  kind: z.enum([
    "executionError",
    "outputSchemaValid",
    "jsonpath",
    "equals",
    "contains",
    "pattern",
    "schema",
    "resource",
    "widget",
  ]),
  path: z.string().optional(),
  equals: z.unknown().optional(),
  contains: z.string().optional(),
  pattern: z.string().optional(),
  type: z.string().optional(),
  uri: z.string().optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
  assert: z.array(z.lazy((): typeof assertRuleSchema => assertRuleSchema)).optional(),
});

export const toolExpectSchema = z.object({
  name: z.string(),
  args: z.record(z.string(), argMatcherSchema).optional(),
  afterTurn: z.number().optional(),
});

export const resultExpectSchema = z.object({
  tool: z.string(),
  assert: z.array(assertRuleSchema),
});

export const widgetExpectSchema = z.object({
  fields: z.record(z.string(), z.unknown()).optional(),
  screenshot: z
    .object({
      rubric: z.string(),
      threshold: z.number().min(0).max(1).optional(),
      tool: z.string().optional(),
      args: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
});

export const turnExpectSchema = z.object({
  tools: z.array(toolExpectSchema).optional(),
  result: resultExpectSchema.optional(),
  widget: widgetExpectSchema.optional(),
});

export const judgeExpectSchema = z.object({
  rubric: z.string(),
  threshold: z.number().min(0).max(1).default(0.7),
  screenshot: z.boolean().optional(),
});

export const scenarioExpectSchema = z.object({
  judge: judgeExpectSchema.optional(),
  tools: z
    .object({
      forbidden: z.array(z.string()).optional(),
    })
    .optional(),
});

export const checkSchema = z.object({
  id: z.string(),
  call: z.object({
    tool: z.string().optional(),
    resource: z.string().optional(),
    mcp: z.enum(["listTools", "listResources", "listPrompts"]).optional(),
    args: z.record(z.string(), z.unknown()).optional(),
  }),
  assert: z.array(assertRuleSchema),
});

export const scenarioSchema = z.object({
  id: z.string(),
  tags: z.array(z.string()).optional(),
  turns: z.array(
    z.object({
      user: z.string(),
      expect: turnExpectSchema.optional(),
    })
  ),
  expect: scenarioExpectSchema.optional(),
});

export const clientSchema = z.object({
  target: z.enum(["mcp-use", "inspector", "chatgpt", "ai-sdk", "claude-agent-sdk"]),
  framework: z.string().optional(),
  models: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),
  runOn: z.array(z.enum(["ci", "manual", "release", "cron"])).optional(),
});

export const triggersSchema = z
  .object({
    manual: z.boolean().optional(),
    ci: z
      .object({
        enabled: z.boolean().optional(),
        branches: z.array(z.string()).optional(),
        watchPaths: z.array(z.string()).optional(),
      })
      .optional(),
    cron: z
      .object({
        enabled: z.boolean().optional(),
        schedule: z.string().optional(),
        branch: z.string().optional(),
      })
      .optional(),
  })
  .optional();

export const agentFlowSchema = z.object({
  id: z.string(),
  type: z.literal("agent"),
  clients: z.array(clientSchema).optional(),
  systemPrompts: z.record(z.string(), z.string()).optional(),
  checks: z.array(checkSchema).optional(),
  scenarios: z.array(scenarioSchema),
});

export const evalSuiteSchema = z.object({
  apiVersion: z.literal(API_VERSION),
  kind: z.literal("EvalSuite"),
  name: z.string(),
  intent: z.string().optional(),
  triggers: triggersSchema,
  server: z
    .object({
      url: z.string().optional(),
      command: z.string().optional(),
      args: z.array(z.string()).optional(),
      env: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
  defaults: z
    .object({
      timeoutMs: z.number().optional(),
      maxAgentSteps: z.number().optional(),
      judgeModel: z.string().optional(),
      rubricThreshold: z.number().optional(),
      client: z.string().optional(),
    })
    .optional(),
  metrics: z
    .object({
      collect: z.array(z.string()).optional(),
      report: z.string().optional(),
      gates: z
        .object({
          toolErrorRateMax: z.number().optional(),
          agentStepsP95Max: z.number().optional(),
          tokensPerSuccessP95Max: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
  ci: z
    .object({
      failOn: z.array(z.string()).optional(),
      parallelCases: z.boolean().optional(),
    })
    .optional(),
  flows: z.array(agentFlowSchema).min(1),
});

export type EvalSuite = z.infer<typeof evalSuiteSchema>;
export type AgentFlow = z.infer<typeof agentFlowSchema>;
export type EvalCheck = z.infer<typeof checkSchema>;
export type EvalScenario = z.infer<typeof scenarioSchema>;
export type AssertRule = z.infer<typeof assertRuleSchema>;
export type ClientTarget = z.infer<typeof clientSchema>;
export type EvalTriggers = z.infer<typeof triggersSchema>;
