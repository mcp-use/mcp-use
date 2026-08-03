import { describe, expect, it } from "vitest";
import { buildServerCapabilityRows } from "../serverCapabilities";

const conformanceCaps = {
  logging: {},
  completions: {},
  tools: { listChanged: true },
  prompts: { listChanged: true },
  resources: { subscribe: true, listChanged: true },
};

describe("buildServerCapabilityRows", () => {
  it("marks conformance-like capabilities as supported with nested features", () => {
    const rows = buildServerCapabilityRows(conformanceCaps);

    const tools = rows.find((row) => row.id === "tools");
    expect(tools?.supported).toBe(true);
    expect(tools?.features).toEqual([
      { id: "listChanged", label: "listChanged" },
    ]);

    const resources = rows.find((row) => row.id === "resources");
    expect(resources?.supported).toBe(true);
    expect(resources?.features).toEqual([
      { id: "subscribe", label: "subscribe" },
      { id: "listChanged", label: "listChanged" },
    ]);

    const logging = rows.find((row) => row.id === "logging");
    expect(logging?.supported).toBe(true);
  });

  it("shows tasks as unsupported when absent", () => {
    const rows = buildServerCapabilityRows(conformanceCaps);
    const tasks = rows.find((row) => row.id === "tasks");
    expect(tasks?.supported).toBe(false);
    expect(tasks?.features).toEqual([]);
  });

  it("labels MCP Apps from extensions with mime types", () => {
    const rows = buildServerCapabilityRows(
      {},
      {
        "io.modelcontextprotocol/ui": {
          mimeTypes: ["text/html;profile=mcp-app"],
        },
      }
    );

    const extensions = rows.find((row) => row.id === "extensions");
    expect(extensions?.supported).toBe(true);
    expect(extensions?.features).toEqual([
      {
        id: "io.modelcontextprotocol/ui",
        label: "MCP Apps",
      },
    ]);
    expect(extensions?.detail).toBe("text/html;profile=mcp-app");
  });

  it("merges capabilities.extensions and connection.extensions", () => {
    const rows = buildServerCapabilityRows(
      {
        extensions: {
          "custom.extension": {},
        },
      },
      {
        "io.modelcontextprotocol/ui": {
          mimeTypes: ["text/html;profile=mcp-app"],
        },
      }
    );

    const extensions = rows.find((row) => row.id === "extensions");
    expect(extensions?.features).toEqual([
      { id: "custom.extension", label: "custom.extension" },
      { id: "io.modelcontextprotocol/ui", label: "MCP Apps" },
    ]);
  });

  it("surfaces experimental sub-keys and unknown top-level capabilities", () => {
    const rows = buildServerCapabilityRows({
      ...conformanceCaps,
      experimental: { foo: {} },
      customCapability: { bar: true },
    });

    const experimental = rows.find((row) => row.id === "experimental");
    expect(experimental?.supported).toBe(true);
    expect(experimental?.features).toEqual([{ id: "foo", label: "foo" }]);

    const custom = rows.find((row) => row.id === "customCapability");
    expect(custom?.supported).toBe(true);
    expect(custom?.features).toEqual([
      { id: "customCapability.bar", label: "bar" },
    ]);
  });

  it("infers MCP Apps from view-bound tools when extensions are absent on wire", () => {
    const rows = buildServerCapabilityRows(
      conformanceCaps,
      {},
      {
        tools: [
          {
            _meta: {
              ui: { resourceUri: "ui://widget/weather.html" },
            },
          },
        ],
      }
    );

    const extensions = rows.find((row) => row.id === "extensions");
    expect(extensions?.supported).toBe(true);
    expect(extensions?.features).toEqual([
      { id: "io.modelcontextprotocol/ui", label: "MCP Apps" },
    ]);
    expect(extensions?.detail).toBe("text/html;profile=mcp-app");
  });

  it("infers MCP Apps from mcp-app resource templates", () => {
    const rows = buildServerCapabilityRows(
      conformanceCaps,
      {},
      {
        resourceTemplates: [{ mimeType: "text/html;profile=mcp-app" }],
      }
    );

    const extensions = rows.find((row) => row.id === "extensions");
    expect(extensions?.supported).toBe(true);
    expect(extensions?.features).toEqual([
      { id: "io.modelcontextprotocol/ui", label: "MCP Apps" },
    ]);
  });
});
