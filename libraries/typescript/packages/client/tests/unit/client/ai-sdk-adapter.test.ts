import { describe, expect, it, vi } from "vitest";
import type {
  CallToolResult,
  RequestOptions,
  Tool,
} from "@modelcontextprotocol/client";
import {
  createAiSdkTools,
  MCPConnection,
  type AiSdkTool,
  type AiSdkToolConnection,
} from "../../../src/index.js";
import { BaseConnector } from "../../../src/transport/base.js";

function makeTool(overrides: Partial<Tool> = {}): Tool {
  return {
    name: "search",
    description: "Search the remote index.",
    title: "Search",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
      $defs: { query: { type: "string" } },
    },
    annotations: {
      title: "Search annotation",
      readOnlyHint: true,
    },
    _meta: {
      "com.example/source": "test",
    },
    ...overrides,
  } as Tool;
}

function makeConnection(
  tools: Tool[] = [makeTool()],
  result: CallToolResult = {
    content: [
      { type: "text", text: "found" },
      {
        type: "resource_link",
        uri: "https://example.com/result",
        name: "result",
      },
    ],
    structuredContent: { count: 1 },
    isError: false,
    _meta: { "com.example/result": "kept" },
  }
): {
  connection: AiSdkToolConnection;
  listTools: ReturnType<typeof vi.fn>;
  callTool: ReturnType<typeof vi.fn>;
} {
  const listTools = vi.fn(async () => tools);
  const callTool = vi.fn(
    async (
      _name: string,
      _args: Record<string, unknown>,
      _options?: RequestOptions
    ) => result
  );
  return {
    connection: { listTools, callTool },
    listTools,
    callTool,
  };
}

describe("createAiSdkTools", () => {
  it("discovers tools only when tools are omitted", async () => {
    const discovered = makeConnection();
    const fromDiscovery = await createAiSdkTools(discovered.connection);

    expect(discovered.listTools).toHaveBeenCalledOnce();
    expect(Object.keys(fromDiscovery)).toEqual(["search"]);

    const supplied = makeConnection();
    const suppliedTool = makeTool({ name: "supplied" });
    const fromDefinitions = await createAiSdkTools(supplied.connection, {
      tools: [suppliedTool],
    });

    expect(supplied.listTools).not.toHaveBeenCalled();
    expect(Object.keys(fromDefinitions)).toEqual(["supplied"]);
  });

  it("preserves MCP metadata and uses a dependency-free dynamic JSON-schema tool", async () => {
    const { connection } = makeConnection();
    const tools = await createAiSdkTools(connection, { clientName: "cloud" });
    const tool = tools.search as AiSdkTool;

    expect(tool.type).toBe("dynamic");
    expect(tool.description).toBe("Search the remote index.");
    expect(tool.title).toBe("Search");
    expect(tool.annotations).toEqual({
      title: "Search annotation",
      readOnlyHint: true,
    });
    expect(tool._meta).toEqual({ "com.example/source": "test" });
    expect(tool.metadata).toMatchObject({
      clientName: "cloud",
      toolName: "search",
      title: "Search",
      annotations: {
        title: "Search annotation",
        readOnlyHint: true,
      },
      _meta: { "com.example/source": "test" },
    });
    expect(tool.toModelOutput).toBeUndefined();

    const schema = tool.inputSchema as {
      jsonSchema: Record<string, unknown>;
      validate(value: unknown): { success: true; value: unknown };
      [Symbol.for("vercel.ai.schema")]: boolean;
      [Symbol.for("vercel.ai.validator")]: boolean;
    };
    expect(schema.jsonSchema).toEqual({
      type: "object",
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
      $defs: { query: { type: "string" } },
    });
    expect(schema[Symbol.for("vercel.ai.schema")]).toBe(true);
    expect(schema[Symbol.for("vercel.ai.validator")]).toBe(true);
    expect(schema.validate({ query: "mcp" })).toEqual({
      success: true,
      value: { query: "mcp" },
    });
  });

  it("preserves the transformed input schema exactly", async () => {
    const { connection } = makeConnection([
      makeTool({
        name: "empty",
        inputSchema: { type: "object" },
      }),
    ]);
    const transformer = vi.fn((schema: Record<string, unknown>) => ({
      ...schema,
      properties: { added: { type: "boolean" } },
      additionalProperties: true,
    }));

    const tools = await createAiSdkTools(connection, {
      transformInputSchema: transformer,
    });

    expect(transformer).toHaveBeenCalledWith({ type: "object" });
    const schema = (tools.empty as AiSdkTool).inputSchema as {
      jsonSchema: Record<string, unknown>;
    };
    expect(schema.jsonSchema).toEqual({
      type: "object",
      properties: { added: { type: "boolean" } },
      additionalProperties: true,
    });
  });

  it("forwards the MCP name, arguments, and abort signal and returns the raw result", async () => {
    const result: CallToolResult = {
      content: [
        { type: "text", text: "raw" },
        { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
      ],
      structuredContent: { answer: 42 },
      isError: true,
      _meta: { "com.example/secret": "preserved" },
    };
    const { connection, callTool } = makeConnection([makeTool()], result);
    const tools = await createAiSdkTools(connection);
    const controller = new AbortController();
    const args = { query: "mcp" };

    const actual = await tools.search.execute?.(args, {
      abortSignal: controller.signal,
      messages: [],
      toolCallId: "tool-call-1",
    });

    expect(actual).toBe(result);
    expect(callTool).toHaveBeenCalledWith("search", args, {
      signal: controller.signal,
    });
  });

  it("does not dispatch an already-aborted execution", async () => {
    const { connection, callTool } = makeConnection();
    const tools = await createAiSdkTools(connection);
    const controller = new AbortController();
    const reason = new Error("cancelled");
    controller.abort(reason);

    await expect(
      tools.search.execute?.(
        { query: "mcp" },
        {
          abortSignal: controller.signal,
          messages: [],
          toolCallId: "tool-call-2",
        }
      )
    ).rejects.toBe(reason);
    expect(callTool).not.toHaveBeenCalled();
  });

  it("rejects duplicate MCP names instead of overwriting a tool", async () => {
    const { connection } = makeConnection([
      makeTool(),
      makeTool({ description: "duplicate" }),
    ]);

    await expect(createAiSdkTools(connection)).rejects.toThrow(
      "Duplicate MCP tool name: search"
    );
  });

  it("supports a legal MCP tool named __proto__", async () => {
    const { connection } = makeConnection([makeTool({ name: "__proto__" })]);
    const tools = await createAiSdkTools(connection);

    expect(Object.hasOwn(tools, "__proto__")).toBe(true);
    expect(Object.keys(tools)).toEqual(["__proto__"]);
    expect(tools.__proto__.type).toBe("dynamic");
  });

  it.each([
    ["legacy", "2025-11-25"],
    ["modern", "2026-07-28"],
  ] as const)(
    "uses the same MCPConnection surface for %s protocol sessions",
    async (era, version) => {
      class TestConnector extends BaseConnector {
        async connect(): Promise<void> {
          (this as any).connected = true;
        }

        get publicIdentifier(): Record<string, string> {
          return { type: "test" };
        }
      }

      const result: CallToolResult = {
        content: [{ type: "text", text: era }],
      };
      const connector = new TestConnector();
      const client = {
        getProtocolEra: () => era,
        getNegotiatedProtocolVersion: () => version,
        getServerCapabilities: () => ({ tools: {} }),
        getServerVersion: () => ({ name: `${era}-server`, version: "1.0.0" }),
        getInstructions: () => undefined,
        listTools: vi.fn(async () => ({ tools: [makeTool()] })),
        callTool: vi.fn(async () => result),
      };
      (connector as any).client = client;
      const connection = new MCPConnection(connector);

      await connection.initialize();
      const tools = await createAiSdkTools(connection);
      const actual = await tools.search.execute?.(
        { query: era },
        { abortSignal: undefined, messages: [], toolCallId: `call-${era}` }
      );

      expect(connection.protocolEra).toBe(era);
      expect(connection.negotiatedProtocolVersion).toBe(version);
      expect(actual).toBe(result);
      expect(client.callTool).toHaveBeenCalledOnce();
    }
  );
});
