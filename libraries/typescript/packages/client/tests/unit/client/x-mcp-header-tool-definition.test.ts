import { describe, expect, it, vi } from "vitest";
import { BaseConnector } from "../../../src/transport/base.js";

/**
 * SEP-2243: parameters marked with `x-mcp-header` in a tool's input schema
 * must be forwarded as `Mcp-Param-*` HTTP request headers by the client
 * transport layer. `BaseConnector.callTool` injects these headers into the
 * `RequestOptions.headers` map so they reach the transport unconditionally
 * on every platform (including browser environments where the SDK's own
 * mirroring is disabled).
 */
describe("x-mcp-header parameter forwarding (SEP-2243)", () => {
  function connectorWithTool(tool: {
    name: string;
    inputSchema: { type: string; properties: Record<string, unknown> };
  }) {
    const connector = new BaseConnector();
    const callToolMock = vi.fn().mockResolvedValue({ content: [] });
    (connector as any).client = { callTool: callToolMock };
    (connector as any).toolsCache = [tool];
    return { connector, callToolMock };
  }

  it("injects Mcp-Param-* headers for x-mcp-header annotated parameters", async () => {
    const tool = {
      name: "test_custom_header",
      inputSchema: {
        type: "object",
        properties: {
          value: { type: "string", "x-mcp-header": "Conformance-Value" },
        },
      },
    };
    const { connector, callToolMock } = connectorWithTool(tool);

    await connector.callTool("test_custom_header", { value: "conformance-e2e" });

    const passedOptions = callToolMock.mock.calls[0][1] as {
      headers?: Record<string, string>;
    };
    expect(passedOptions.headers).toEqual(
      expect.objectContaining({
        "Mcp-Param-Conformance-Value": "conformance-e2e",
      })
    );
  });

  it("passes toolDefinition from the tools cache when none is supplied", async () => {
    const tool = {
      name: "test_custom_header",
      inputSchema: {
        type: "object",
        properties: {
          value: { type: "string", "x-mcp-header": "Conformance-Value" },
        },
      },
    };
    const { connector, callToolMock } = connectorWithTool(tool);

    await connector.callTool("test_custom_header", { value: "conformance-e2e" });

    expect(callToolMock).toHaveBeenCalledWith(
      { name: "test_custom_header", arguments: { value: "conformance-e2e" } },
      expect.objectContaining({ toolDefinition: tool })
    );
  });

  it("prefers the caller-supplied toolDefinition over the cache", async () => {
    const cached = {
      name: "test_custom_header",
      inputSchema: { type: "object", properties: {} },
    };
    const supplied = {
      name: "test_custom_header",
      inputSchema: {
        type: "object",
        properties: {
          value: { type: "string", "x-mcp-header": "Conformance-Value" },
        },
      },
    };
    const { connector, callToolMock } = connectorWithTool(cached);

    await connector.callTool(
      "test_custom_header",
      { value: "conformance-e2e" },
      { toolDefinition: supplied as any }
    );

    // Headers are built from the supplied toolDefinition's schema.
    const passedOptions = callToolMock.mock.calls[0][1] as {
      headers?: Record<string, string>;
      toolDefinition: unknown;
    };
    expect(passedOptions.toolDefinition).toBe(supplied);
    expect(passedOptions.headers).toEqual(
      expect.objectContaining({
        "Mcp-Param-Conformance-Value": "conformance-e2e",
      })
    );
  });

  it("skips header injection when the tool is not in the cache", async () => {
    const connector = new BaseConnector();
    const callToolMock = vi.fn().mockResolvedValue({ content: [] });
    (connector as any).client = { callTool: callToolMock };
    (connector as any).toolsCache = [];

    await connector.callTool("unknown_tool", { value: "test" });

    const opts = callToolMock.mock.calls[0][1] as Record<string, unknown>;
    expect(opts.toolDefinition).toBeUndefined();
    expect(
      (opts.headers as Record<string, string> | undefined)?.[
        "Mcp-Param-Value"
      ]
    ).toBeUndefined();
  });

  it("skips header injection when the cache has not been populated", async () => {
    const connector = new BaseConnector();
    const callToolMock = vi.fn().mockResolvedValue({ content: [] });
    (connector as any).client = { callTool: callToolMock };
    // toolsCache stays null (not yet initialized)

    await connector.callTool("some_tool", {});

    const opts = callToolMock.mock.calls[0][1] as Record<string, unknown>;
    expect(opts.toolDefinition).toBeUndefined();
  });

  it("merges caller-supplied headers with the injected Mcp-Param-* headers", async () => {
    const tool = {
      name: "test_custom_header",
      inputSchema: {
        type: "object",
        properties: {
          value: { type: "string", "x-mcp-header": "Conformance-Value" },
        },
      },
    };
    const { connector, callToolMock } = connectorWithTool(tool);

    await connector.callTool(
      "test_custom_header",
      { value: "hello" },
      { headers: { "X-Custom": "my-value" } }
    );

    const passedOptions = callToolMock.mock.calls[0][1] as {
      headers?: Record<string, string>;
    };
    expect(passedOptions.headers).toEqual(
      expect.objectContaining({
        "X-Custom": "my-value",
        "Mcp-Param-Conformance-Value": "hello",
      })
    );
  });

  it("skips null/undefined parameter values", async () => {
    const tool = {
      name: "test_tool",
      inputSchema: {
        type: "object",
        properties: {
          required: { type: "string", "x-mcp-header": "Required-Header" },
          optional: { type: "string", "x-mcp-header": "Optional-Header" },
        },
      },
    };
    const { connector, callToolMock } = connectorWithTool(tool);

    await connector.callTool("test_tool", { required: "present" });

    const passedOptions = callToolMock.mock.calls[0][1] as {
      headers?: Record<string, string>;
    };
    expect(passedOptions.headers?.["Mcp-Param-Required-Header"]).toBe(
      "present"
    );
    expect(passedOptions.headers?.["Mcp-Param-Optional-Header"]).toBeUndefined();
  });
});
