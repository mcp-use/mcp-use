/**
 * Compile-time contract tests for the `/react` typing layer with an empty Register.
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import { MCPServer } from "../src/index.js";
import type { ToolRef } from "../src/index.js";
import type { DeepPartial } from "../src/react/types/register.js";
import type {
  CallToolHandle,
  useCallTool,
} from "../src/react/hooks/use-call-tool.js";
import type {
  CallToolResult,
  CallToolSuccess,
} from "../src/react/types/result-types.js";

describe("DeepPartial", () => {
  it("recurses over arrays, nested objects, and preserves primitives", () => {
    type Nested = {
      query?: string;
      items: { id: string; tags: string[] }[];
      count: number;
    };
    type PartialNested = DeepPartial<Nested>;

    expectTypeOf<PartialNested>().toMatchTypeOf<{
      query?: string;
      items?: { id?: string; tags?: string[] }[];
      count?: number;
    }>();
    expect(true).toBe(true);
  });
});

describe("useCallTool empty Register", () => {
  it("accepts a plain string when Register is empty", () => {
    type NameParam = Parameters<typeof useCallTool>[0];
    expectTypeOf<NameParam>().toEqualTypeOf<string>();
    expect(true).toBe(true);
  });

  it("infers from a ToolRef value", () => {
    const server = new MCPServer({ name: "types", version: "0.0.0" });
    const ref = server.tool(
      {
        name: "echo",
        inputSchema: z.object({ text: z.string() }),
        outputSchema: z.object({ text: z.string() }),
      },
      async ({ text }) => ({
        content: [{ type: "text", text }],
        structuredContent: { text },
      })
    );
    type FromRef = CallToolHandle<{ text: string }, { text: string }>;
    expectTypeOf<FromRef["callTool"]>().parameters.toEqualTypeOf<
      [{ text: string }]
    >();
    expectTypeOf(ref).toMatchTypeOf<
      ToolRef<"echo", { text: string }, { text: string }>
    >();
    expect(true).toBe(true);
  });

  it("infers never output from a schema-less ToolRef and drops the structuredContent guarantee", () => {
    const server = new MCPServer({ name: "types", version: "0.0.0" });
    const ref = server.tool(
      {
        name: "ping",
        inputSchema: z.object({ id: z.string() }),
      },
      async ({ id }) => ({
        content: [{ type: "text", text: id }],
      })
    );
    expectTypeOf(ref).toMatchTypeOf<ToolRef<"ping", { id: string }, never>>();

    type FromRef = CallToolHandle<{ id: string }, never>;
    type Success = Awaited<ReturnType<FromRef["callTool"]>>;
    // Content-only successes are valid: exactly the base non-error shape.
    expectTypeOf<Success>().toEqualTypeOf<
      CallToolResult & { isError?: false }
    >();
    // structuredContent stays the base optional `unknown` — not typed output.
    expectTypeOf<Success["structuredContent"]>().toEqualTypeOf<unknown>();
    expectTypeOf<FromRef["data"]>().toEqualTypeOf<
      (CallToolResult & { isError?: false }) | undefined
    >();
    expect(true).toBe(true);
  });

  it("shares the CallToolSuccess result contract across string, ToolRef, and explicit generics", () => {
    type Output = { text: string };
    type FromString = CallToolHandle<Record<string, unknown>, Output>;
    type FromRef = CallToolHandle<{ text: string }, Output>;
    type FromExplicit = CallToolHandle<{ text: string }, Output>;

    expectTypeOf<Awaited<ReturnType<FromString["callTool"]>>>().toEqualTypeOf<
      CallToolSuccess<Output>
    >();
    expectTypeOf<Awaited<ReturnType<FromRef["callTool"]>>>().toEqualTypeOf<
      CallToolSuccess<Output>
    >();
    expectTypeOf<Awaited<ReturnType<FromExplicit["callTool"]>>>().toEqualTypeOf<
      CallToolSuccess<Output>
    >();
    expectTypeOf<FromString["data"]>().toEqualTypeOf<
      CallToolSuccess<Output> | undefined
    >();
    expectTypeOf<FromRef["data"]>().toEqualTypeOf<
      CallToolSuccess<Output> | undefined
    >();
    expectTypeOf<FromExplicit["data"]>().toEqualTypeOf<
      CallToolSuccess<Output> | undefined
    >();

    expect(true).toBe(true);
  });
});
