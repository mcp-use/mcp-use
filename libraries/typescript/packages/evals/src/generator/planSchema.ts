import { z } from "zod";

/**
 * Zod schema for a tool test case.
 * Defines a single test scenario for an MCP tool.
 */
export const ToolTestCaseSchema = z.object({
  /** Test category: direct (explicit), indirect (implicit), negative (shouldn't use), or error (should fail) */
  category: z.enum(["direct", "indirect", "negative", "error"]),
  /** User prompt to send to the agent */
  prompt: z.string().min(1),
  /** Expected tool call with name and input parameters (for direct tests) */
  expectedToolCall: z
    .object({
      name: z.string().min(1),
      input: z.record(z.string(), z.unknown()).optional(),
    })
    .nullable()
    .optional(),
  /** Whether the test expects a failure/error */
  expectFailure: z.boolean().optional(),
  /** Whether the tool should NOT be used (for negative tests) */
  expectNotUsed: z.boolean().optional(),
  /** Optional human-readable description of what this test validates */
  description: z.string().optional(),
  /** Semantic assertion using judge() for behavioral validation */
  judgeExpectation: z.string().nullable().optional(),
});

/**
 * Zod schema for a resource test case.
 * Defines a single test scenario for an MCP resource.
 */
export const ResourceTestCaseSchema = z.object({
  /** Test category: direct (explicit), indirect (implicit), or negative (shouldn't use) */
  category: z.enum(["direct", "indirect", "negative"]),
  /** User prompt to send to the agent */
  prompt: z.string().min(1),
  /** Whether the resource should NOT be accessed (for negative tests) */
  expectNotUsed: z.boolean().optional(),
  /** Optional human-readable description of what this test validates */
  description: z.string().optional(),
  /** Semantic assertion using judge() for behavioral validation */
  judgeExpectation: z.string().nullable().optional(),
});

/**
 * Zod schema for a tool test plan.
 * Groups multiple test cases for a single tool.
 */
export const ToolTestPlanSchema = z.object({
  /** Name of the tool being tested */
  name: z.string().min(1),
  /** Optional description of the tool */
  description: z.string().optional(),
  /** Array of test cases for this tool */
  tests: z.array(ToolTestCaseSchema),
});

/**
 * Zod schema for a resource test plan.
 * Groups multiple test cases for a single resource.
 */
export const ResourceTestPlanSchema = z.object({
  /** Name of the resource being tested */
  name: z.string().min(1),
  /** Array of test cases for this resource */
  tests: z.array(ResourceTestCaseSchema),
});

/**
 * Zod schema for a complete test plan.
 * Contains test plans for all tools and resources in a server.
 */
export const TestPlanSchema = z.object({
  /** Optional server name */
  server: z.string().min(1).optional(),
  /** Test plans for each tool */
  tools: z.array(ToolTestPlanSchema),
  /** Test plans for each resource */
  resources: z.array(ResourceTestPlanSchema),
});

/**
 * TypeScript type for a tool test case.
 * Inferred from ToolTestCaseSchema.
 */
export type ToolTestCase = z.infer<typeof ToolTestCaseSchema>;

/**
 * TypeScript type for a resource test case.
 * Inferred from ResourceTestCaseSchema.
 */
export type ResourceTestCase = z.infer<typeof ResourceTestCaseSchema>;

/**
 * TypeScript type for a tool test plan.
 * Inferred from ToolTestPlanSchema.
 */
export type ToolTestPlan = z.infer<typeof ToolTestPlanSchema>;

/**
 * TypeScript type for a resource test plan.
 * Inferred from ResourceTestPlanSchema.
 */
export type ResourceTestPlan = z.infer<typeof ResourceTestPlanSchema>;

/**
 * TypeScript type for a complete test plan.
 * Inferred from TestPlanSchema.
 */
export type TestPlan = z.infer<typeof TestPlanSchema>;
