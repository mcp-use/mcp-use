import { afterEach, describe, expect, it, vi } from "vitest";
import { BaseConnector } from "../../../src/transport/base.js";
import {
  buildMcpParamHeaders,
  sdkMirrorsMcpParamHeaders,
} from "../../../src/transport/mcp-param-headers.js";

const customHeaderSchema = {
  type: "object",
  properties: {
    value: { type: "string", "x-mcp-header": "Conformance-Value" },
  },
};

describe("buildMcpParamHeaders", () => {
  it("mirrors an annotated string parameter", () => {
    expect(
      buildMcpParamHeaders(customHeaderSchema, { value: "conformance-e2e" })
    ).toEqual({ "Mcp-Param-Conformance-Value": "conformance-e2e" });
  });

  it("stringifies booleans and numbers", () => {
    const schema = {
      type: "object",
      properties: {
        flag: { type: "boolean", "x-mcp-header": "Flag" },
        count: { type: "integer", "x-mcp-header": "Count" },
        ratio: { type: "number", "x-mcp-header": "Ratio" },
      },
    };
    expect(
      buildMcpParamHeaders(schema, { flag: false, count: 3, ratio: 1.5 })
    ).toEqual({
      "Mcp-Param-Flag": "false",
      "Mcp-Param-Count": "3",
      "Mcp-Param-Ratio": "1.5",
    });
  });

  it("omits absent, null, and non-primitive values", () => {
    const schema = {
      type: "object",
      properties: {
        a: { type: "string", "x-mcp-header": "A" },
        b: { type: "string", "x-mcp-header": "B" },
        c: { type: "string", "x-mcp-header": "C" },
        d: { type: "number", "x-mcp-header": "D" },
      },
    };
    expect(
      buildMcpParamHeaders(schema, { b: null, c: { nested: true }, d: NaN })
    ).toEqual({});
    expect(buildMcpParamHeaders(schema, undefined)).toEqual({});
  });

  it("wraps values that are not plain ASCII field values in the Base64 sentinel", () => {
    const encode = (value: string) =>
      buildMcpParamHeaders(customHeaderSchema, { value })[
        "Mcp-Param-Conformance-Value"
      ];

    expect(encode("héllo")).toBe("=?base64?aMOpbGxv?=");
    expect(encode("")).toBe("=?base64??=");
    expect(encode(" padded ")).toBe("=?base64?IHBhZGRlZCA=?=");
    expect(encode("line\nbreak")).toBe("=?base64?bGluZQpicmVhaw==?=");
    expect(encode("=?base64?abc?=")).toBe("=?base64?PT9iYXNlNjQ/YWJjPz0=?=");
    expect(encode("tab\tinside")).toBe("tab\tinside");
  });

  it("reads nested parameters through a chain of properties", () => {
    const schema = {
      type: "object",
      properties: {
        outer: {
          type: "object",
          properties: {
            inner: { type: "string", "x-mcp-header": "Inner" },
          },
        },
      },
    };
    expect(buildMcpParamHeaders(schema, { outer: { inner: "x" } })).toEqual({
      "Mcp-Param-Inner": "x",
    });
    expect(buildMcpParamHeaders(schema, { outer: "not-an-object" })).toEqual(
      {}
    );
  });

  it("skips declarations with an invalid header name or type", () => {
    const schema = {
      type: "object",
      properties: {
        badName: { type: "string", "x-mcp-header": "Bad Name\r\nX: y" },
        empty: { type: "string", "x-mcp-header": "" },
        badType: { type: "object", "x-mcp-header": "Obj" },
        noType: { "x-mcp-header": "NoType" },
        list: {
          type: "array",
          items: { type: "string", "x-mcp-header": "Item" },
        },
        first: { type: "string", "x-mcp-header": "Dup" },
        second: { type: "string", "x-mcp-header": "dup" },
      },
    };
    expect(
      buildMcpParamHeaders(schema, {
        badName: "a",
        empty: "b",
        badType: "c",
        noType: "d",
        list: ["e"],
        first: "f",
        second: "g",
      })
    ).toEqual({ "Mcp-Param-Dup": "f" });
  });

  it("returns no headers for schemas without annotations", () => {
    expect(buildMcpParamHeaders(undefined, { value: "x" })).toEqual({});
    expect(
      buildMcpParamHeaders(
        { type: "object", properties: { value: { type: "string" } } },
        { value: "x" }
      )
    ).toEqual({});
  });
});

describe("BaseConnector.callTool x-mcp-header mirroring", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubBrowser() {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {});
  }

  function connectorWithClient(era: "legacy" | "modern") {
    const callTool = vi.fn(async () => ({ content: [] }));
    const connector = new BaseConnector();
    (connector as any).client = { getProtocolEra: () => era, callTool };
    (connector as any).toolsCache = [
      { name: "test_custom_header", inputSchema: customHeaderSchema },
      { name: "plain", inputSchema: { type: "object", properties: {} } },
    ];
    return { connector, callTool };
  }

  it("detects when the SDK does its own mirroring", () => {
    expect(sdkMirrorsMcpParamHeaders()).toBe(true);
    stubBrowser();
    expect(sdkMirrorsMcpParamHeaders()).toBe(false);
  });

  it("adds Mcp-Param-* headers in the browser and keeps the body arguments", async () => {
    stubBrowser();
    const { connector, callTool } = connectorWithClient("modern");

    await connector.callTool("test_custom_header", {
      value: "conformance-e2e",
    });

    expect(callTool).toHaveBeenCalledWith(
      { name: "test_custom_header", arguments: { value: "conformance-e2e" } },
      { headers: { "Mcp-Param-Conformance-Value": "conformance-e2e" } }
    );
  });

  it("preserves caller-supplied options and headers", async () => {
    stubBrowser();
    const { connector, callTool } = connectorWithClient("modern");

    await connector.callTool(
      "test_custom_header",
      { value: "v" },
      { timeout: 5000, headers: { "X-Trace": "abc" } }
    );

    expect(callTool.mock.calls[0][1]).toEqual({
      timeout: 5000,
      headers: { "X-Trace": "abc", "Mcp-Param-Conformance-Value": "v" },
    });
  });

  it("leaves options untouched outside the browser", async () => {
    const { connector, callTool } = connectorWithClient("modern");

    await connector.callTool("test_custom_header", { value: "v" });

    expect(callTool.mock.calls[0][1]).toBeUndefined();
  });

  it("sends no Mcp-Param-* headers on legacy connections", async () => {
    stubBrowser();
    const { connector, callTool } = connectorWithClient("legacy");

    await connector.callTool("test_custom_header", { value: "v" });

    expect(callTool.mock.calls[0][1]).toBeUndefined();
  });

  it("leaves options untouched for tools without annotations or not in the cache", async () => {
    stubBrowser();
    const { connector, callTool } = connectorWithClient("modern");

    await connector.callTool("plain", {});
    await connector.callTool("unknown_tool", { value: "v" });

    expect(callTool.mock.calls[0][1]).toBeUndefined();
    expect(callTool.mock.calls[1][1]).toBeUndefined();
  });
});
