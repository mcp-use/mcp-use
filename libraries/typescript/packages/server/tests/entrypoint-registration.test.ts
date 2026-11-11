import { fromJsonSchema } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { MCPServer } from "../src/index.js";
import type { ToolDefinition, ToolViewEntrypoint } from "../src/tools.js";

const file = z.object({ name: z.string(), resourceUri: z.string() });
const fileEntrypoint = { type: "file", extensions: [".csv"] } as const;

function register(
  inputSchema: ToolDefinition["inputSchema"],
  entrypoints: readonly ToolViewEntrypoint[]
) {
  const server = new MCPServer({ name: "entrypoint-validation", version: "1" });
  server.tool(
    {
      name: "launch",
      ...(inputSchema ? { inputSchema } : {}),
      outputSchema: z.object({}),
      view: { name: "app", entrypoints },
    },
    () => ({ content: [], structuredContent: {} })
  );
  return server;
}

describe("entrypoint registration", () => {
  it.each(["global", "thread"] as const)(
    "rejects required input for a %s launch before advertising it",
    (type) => {
      expect(() =>
        register(z.object({ query: z.string() }), [{ type }])
      ).toThrow(/launch.*entrypoint.*inputSchema/);
    }
  );

  it.each(["global", "thread"] as const)(
    "accepts optional and defaulted input for %s",
    (type) => {
      expect(() =>
        register(
          z.object({
            query: z.string().default("all"),
            page: z.number().optional(),
          }),
          [{ type }]
        )
      ).not.toThrow();
      expect(() => register(undefined, [{ type }])).not.toThrow();
    }
  );

  it.each([
    z.object({ file, query: z.string() }),
    z.object({ file: z.object({ name: z.number(), resourceUri: z.string() }) }),
    z.object({ file: file.extend({ token: z.string() }) }),
  ])("rejects file schemas incompatible with the host payload", (schema) => {
    expect(() => register(schema, [fileEntrypoint])).toThrow(
      /entrypoint.*inputSchema/
    );
  });

  it("requires an input schema for file launches", () => {
    expect(() => register(undefined, [fileEntrypoint])).toThrow(
      /entrypoint.*inputSchema/
    );
  });

  it("accepts file and combined launch contracts", () => {
    expect(() => register(z.object({ file }), [fileEntrypoint])).not.toThrow();
    expect(() =>
      register(z.object({ file: file.optional() }), [
        { type: "global" },
        { type: "thread" },
        fileEntrypoint,
      ])
    ).not.toThrow();
    expect(() =>
      register(z.object({ file }), [{ type: "global" }, fileEntrypoint])
    ).toThrow(/entrypoint.*inputSchema/);
  });

  it("validates the schema alias and gives inputSchema precedence", () => {
    const server = new MCPServer({ name: "aliases", version: "1" });
    const definition = {
      name: "launch",
      schema: z.object({ query: z.string() }),
      outputSchema: z.object({}),
      view: { name: "app", entrypoints: [{ type: "global" }] as const },
    };
    expect(() =>
      server.tool(definition, () => ({ content: [], structuredContent: {} }))
    ).toThrow(/entrypoint.*inputSchema/);
    // A rejected registration must not reserve the view name.
    expect(() =>
      server.tool({ ...definition, inputSchema: z.object({}) }, () => ({
        content: [],
        structuredContent: {},
      }))
    ).not.toThrow();
  });

  it("checks JSON Schema compositions instead of just root required fields", () => {
    const schema = fromJsonSchema({
      type: "object",
      allOf: [
        {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      ],
    });
    expect(() => register(schema, [{ type: "global" }])).toThrow(
      /entrypoint.*inputSchema/
    );
  });

  it("does not execute application validators during registration", () => {
    const schema = z.object({ query: z.string().optional() });
    const validate = vi.spyOn(schema["~standard"], "validate");
    register(schema, [{ type: "global" }]);
    expect(validate).not.toHaveBeenCalled();
  });

  it("leaves tools without launchers unrestricted", () => {
    expect(() => register(z.object({ query: z.string() }), [])).not.toThrow();
  });
});
