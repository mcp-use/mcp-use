/**
 * Tests for advertising client capabilities and SEP-1724 extensions.
 *
 * Covers:
 * - mcpApps() helper shape and identifier/MIME constants
 * - HttpConnector spreads `opts.capabilities` and the SDK-level
 *   `clientOptions.capabilities` into the initialize handshake, with the
 *   higher-level `capabilities` option overriding `clientOptions` and the
 *   connector's auto-managed fields (`roots` etc.) winning over both.
 */

import { describe, it, expect } from "vitest";
import {
  MCP_APPS_EXTENSION_ID,
  MCP_APPS_MIME_TYPE,
  mcpApps,
} from "../../../src/extensions.js";
import { HttpConnector } from "../../../src/connectors/http.js";

describe("mcpApps() helper", () => {
  it("returns the canonical SEP-1865 extension fragment", () => {
    expect(mcpApps()).toEqual({
      [MCP_APPS_EXTENSION_ID]: { mimeTypes: [MCP_APPS_MIME_TYPE] },
    });
  });

  it("exposes the canonical extension identifier and MIME type", () => {
    expect(MCP_APPS_EXTENSION_ID).toBe("io.modelcontextprotocol/ui");
    expect(MCP_APPS_MIME_TYPE).toBe("text/html;profile=mcp-app");
  });
});

describe("HttpConnector capability advertisement", () => {
  it("does not include extensions when none are provided", () => {
    const connector = new HttpConnector("http://localhost:3000");
    const options = (connector as any).buildClientOptions();
    expect(options.capabilities.extensions).toBeUndefined();
  });

  it("advertises capabilities supplied via the top-level option", () => {
    const connector = new HttpConnector("http://localhost:3000", {
      capabilities: { extensions: mcpApps() },
    });
    const options = (connector as any).buildClientOptions();
    expect(options.capabilities.extensions).toEqual(mcpApps());
  });

  it("advertises capabilities supplied via clientOptions.capabilities", () => {
    const connector = new HttpConnector("http://localhost:3000", {
      clientOptions: {
        capabilities: { extensions: mcpApps() } as any,
      },
    });
    const options = (connector as any).buildClientOptions();
    expect(options.capabilities.extensions).toEqual(mcpApps());
  });

  it("top-level capabilities wins over clientOptions.capabilities on conflicts", () => {
    const connector = new HttpConnector("http://localhost:3000", {
      capabilities: { extensions: { "vendor/ext": { from: "top" } } },
      clientOptions: {
        capabilities: {
          extensions: { "vendor/ext": { from: "clientOptions" } },
        } as any,
      },
    });
    const options = (connector as any).buildClientOptions();
    expect(options.capabilities.extensions).toEqual({
      "vendor/ext": { from: "top" },
    });
  });

  it("auto-managed roots is preserved alongside user-supplied capabilities", () => {
    const connector = new HttpConnector("http://localhost:3000", {
      capabilities: { extensions: mcpApps() },
    });
    const options = (connector as any).buildClientOptions();
    expect(options.capabilities.roots).toEqual({ listChanged: true });
    expect(options.capabilities.extensions).toEqual(mcpApps());
  });

  it("auto-managed sampling overrides user-supplied sampling when callback is present", () => {
    const connector = new HttpConnector("http://localhost:3000", {
      capabilities: { sampling: { custom: true } as any },
      onSampling: async () => ({
        role: "assistant",
        content: { type: "text", text: "ok" },
        model: "m",
        stopReason: "endTurn",
      }),
    });
    const options = (connector as any).buildClientOptions();
    expect(options.capabilities.sampling).toEqual({});
  });
});
