import { z } from "zod";

export const EvalAssertionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("status"),
    equals: z.enum(["ok", "error"]),
  }),
  z.object({
    type: z.literal("content_contains"),
    value: z.string(),
  }),
  z.object({
    type: z.literal("content_regex"),
    pattern: z.string(),
  }),
]);

export const EvalCaseSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("protocol"),
    name: z.string(),
    method: z.string(),
    params: z.record(z.string(), z.unknown()).optional(),
    expect: z.array(EvalAssertionSchema).default([]),
  }),
  z.object({
    type: z.literal("tool"),
    name: z.string(),
    tool: z.string(),
    input: z.record(z.string(), z.unknown()).default({}),
    expect: z.array(EvalAssertionSchema).default([]),
  }),
  z.object({
    type: z.literal("conversation"),
    name: z.string(),
    messages: z.array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      })
    ),
    expect: z.array(EvalAssertionSchema).default([]),
  }),
]);

export const EvalSpecSchema = z.object({
  apiVersion: z.literal("mcp-use.dev/eval/v1"),
  name: z.string(),
  runner: z.enum(["local", "cloud", "chatgpt"]).default("local"),
  server: z.string().optional(),
  mcpServers: z
    .record(z.string(), z.record(z.string(), z.unknown()))
    .optional(),
  tests: z.array(EvalCaseSchema).min(1),
});

export type EvalAssertion = z.infer<typeof EvalAssertionSchema>;
export type EvalCase = z.infer<typeof EvalCaseSchema>;
export type EvalSpec = z.infer<typeof EvalSpecSchema>;

export function parseEvalSpec(input: unknown): EvalSpec {
  return EvalSpecSchema.parse(input);
}
