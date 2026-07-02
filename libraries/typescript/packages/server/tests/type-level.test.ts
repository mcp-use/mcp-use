/**
 * Compile-time contract tests for the result-type model. vitest executes this
 * file but does not typecheck it — the real assertions are the
 * `@ts-expect-error` directives and `expectTypeOf` calls, enforced by
 * `pnpm typecheck` (tsc over tsconfig.test.json). An unused `@ts-expect-error`
 * fails that typecheck, so a regression in strictness cannot land silently.
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import { MCPServer } from "../src/index.js";
import type { CallToolResult, ToolResult } from "../src/index.js";

const outputSchema = z.object({ answer: z.number() });

describe("ToolResult resolution", () => {
  it("is the raw CallToolResult when no output type is declared", () => {
    expectTypeOf<ToolResult>().toEqualTypeOf<CallToolResult>();
  });

  it("requires matching structuredContent or isError when one is", () => {
    // Assignment-position checks (expectTypeOf's match helpers choke on the
    // SDK result type's index signature).
    const structured: ToolResult<{ answer: number }> = {
      content: [{ type: "text", text: "42" }],
      structuredContent: { answer: 42 },
    };
    const error: ToolResult<{ answer: number }> = {
      content: [{ type: "text", text: "boom" }],
      isError: true,
    };
    // @ts-expect-error — content-only results need structuredContent or isError
    const contentOnly: ToolResult<{ answer: number }> = {
      content: [{ type: "text", text: "hi" }],
    };
    expect([structured, error, contentOnly]).toBeDefined(); // compile-time only
  });
});

describe("tool registration return-position checks", () => {
  it("accepts structured and error results for tools with an outputSchema", () => {
    const server = new MCPServer({ name: "types", version: "0.0.0" });
    server.tool({ name: "structured", outputSchema }, async () => ({
      content: [{ type: "text", text: "42" }],
      structuredContent: { answer: 42 },
    }));
    server.tool({ name: "err", outputSchema }, async () => ({
      content: [{ type: "text", text: "boom" }],
      isError: true,
    }));
    expect(true).toBe(true); // assertions above are compile-time
  });

  it("rejects content-only and mistyped results when an outputSchema is declared", () => {
    const server = new MCPServer({ name: "types", version: "0.0.0" });
    server.tool(
      { name: "content-only", outputSchema },
      // @ts-expect-error — no structuredContent; the SDK would reject this at call time
      async () => ({ content: [{ type: "text", text: "no payload" }] })
    );
    server.tool(
      { name: "wrong-shape", outputSchema },
      // @ts-expect-error — structuredContent must match the outputSchema
      async () => ({
        content: [{ type: "text", text: "not a number" }],
        structuredContent: { answer: "not a number" },
      })
    );
    expect(true).toBe(true); // assertions above are compile-time
  });

  it("allows non-object outputSchema roots (2026-07-28 wire)", () => {
    const server = new MCPServer({ name: "types", version: "0.0.0" });
    server.tool(
      { name: "array-root", outputSchema: z.array(z.number()) },
      async () => ({ content: [], structuredContent: [1, 2, 3] })
    );
    server.tool(
      { name: "primitive-root", outputSchema: z.number() },
      async () => ({ content: [], structuredContent: 42 })
    );
    server.tool(
      { name: "mismatched-root", outputSchema: z.array(z.number()) },
      // @ts-expect-error — structuredContent must match the array schema
      async () => ({ content: [], structuredContent: { answer: 42 } })
    );
    expect(true).toBe(true); // assertions above are compile-time
  });

  it("accepts any CallToolResult when no outputSchema is declared", () => {
    const server = new MCPServer({ name: "types", version: "0.0.0" });
    server.tool({ name: "free-text" }, async () => ({
      content: [{ type: "text", text: "hi" }],
    }));
    server.tool({ name: "free-structured" }, async () => ({
      content: [{ type: "text", text: "{}" }],
      structuredContent: { anything: true },
    }));
    server.tool({ name: "free-error" }, async () => ({
      content: [{ type: "text", text: "boom" }],
      isError: true,
    }));
    expect(true).toBe(true); // assertions above are compile-time
  });
});

describe("template variable inference", () => {
  it("extracts operators, explode/prefix modifiers, and comma lists", () => {
    const server = new MCPServer({ name: "types", version: "0.0.0" });
    server.resourceTemplate(
      { name: "multi", uriTemplate: "files://{dir}/{file}{.ext}{?q,limit*}" },
      async (uri, params) => {
        expectTypeOf(params).toEqualTypeOf<{
          dir: string | string[];
          file: string | string[];
          ext: string | string[];
          q: string | string[];
          limit: string | string[];
        }>();
        return { contents: [{ uri: uri.href, text: "ok" }] };
      }
    );
    expect(true).toBe(true); // assertions above are compile-time
  });
});
