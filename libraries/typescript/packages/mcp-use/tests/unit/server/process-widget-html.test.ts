/**
 * Tests for processWidgetHtml's asset-path rewriting. These guard the
 * decoupling of build-time basePath (baked into widget HTML by the CLI) from
 * the live runtime basePath (resolved from the MCPServer constructor): the
 * rewrite must succeed even when the two differ, since the CLI no longer
 * needs to know the "real" basePath at build time.
 */

import { describe, expect, it } from "vitest";
import { processWidgetHtml } from "../../../src/server/widgets/widget-helpers.js";

describe("processWidgetHtml", () => {
  it("rewrites asset paths built with the same basePath as the live one", () => {
    const html =
      '<html><head></head><body><script src="/mcp/mcp-use/widgets/kanban-board/index.js"></script></body></html>';

    const result = processWidgetHtml(
      html,
      "kanban-board",
      "http://localhost:3000",
      "/mcp"
    );

    expect(result).toContain(
      'src="http://localhost:3000/mcp/mcp-use/widgets/kanban-board/index.js"'
    );
  });

  it("rewrites asset paths baked with a DIFFERENT basePath than the live one", () => {
    // Simulates a build where the CLI baked a placeholder/default basePath
    // that no longer matches the basePath configured on the live server.
    const html =
      '<html><head></head><body><script src="/mcp/mcp-use/widgets/kanban-board/index.js"></script></body></html>';

    const result = processWidgetHtml(
      html,
      "kanban-board",
      "http://localhost:3000",
      "/api"
    );

    expect(result).toContain(
      'src="http://localhost:3000/api/mcp-use/widgets/kanban-board/index.js"'
    );
    expect(result).not.toContain("/mcp/mcp-use/widgets");
  });

  it("rewrites href attributes the same way as src", () => {
    const html =
      '<html><head><link rel="stylesheet" href="/mcp/mcp-use/widgets/kanban-board/index.css"></head><body></body></html>';

    const result = processWidgetHtml(
      html,
      "kanban-board",
      "http://localhost:3000",
      "/custom"
    );

    expect(result).toContain(
      'href="http://localhost:3000/custom/mcp-use/widgets/kanban-board/index.css"'
    );
  });

  it("rewrites correctly when the live basePath is root-mounted", () => {
    const html =
      '<html><head></head><body><script src="/mcp/mcp-use/widgets/kanban-board/index.js"></script></body></html>';

    const result = processWidgetHtml(
      html,
      "kanban-board",
      "http://localhost:3000",
      ""
    );

    expect(result).toContain(
      'src="http://localhost:3000/mcp-use/widgets/kanban-board/index.js"'
    );
  });

  it("leaves absolute assetPrefix/CDN URLs untouched", () => {
    // `assetPrefix` builds bake absolute URLs pointing at a CDN/bucket; the
    // serve-time rewrite must not pull those assets back to the server origin.
    const html =
      '<html><head><link rel="stylesheet" href="https://cdn.example.com/mcp-use/widgets/kanban-board/index.css"></head><body><script src="https://cdn.example.com/mcp-use/widgets/kanban-board/index.js"></script></body></html>';

    const result = processWidgetHtml(
      html,
      "kanban-board",
      "http://localhost:3000",
      "/mcp"
    );

    expect(result).toContain(
      'src="https://cdn.example.com/mcp-use/widgets/kanban-board/index.js"'
    );
    expect(result).toContain(
      'href="https://cdn.example.com/mcp-use/widgets/kanban-board/index.css"'
    );
  });

  it("leaves protocol-relative URLs untouched", () => {
    const html =
      '<html><head></head><body><script src="//cdn.example.com/mcp-use/widgets/kanban-board/index.js"></script></body></html>';

    const result = processWidgetHtml(
      html,
      "kanban-board",
      "http://localhost:3000",
      "/mcp"
    );

    expect(result).toContain(
      'src="//cdn.example.com/mcp-use/widgets/kanban-board/index.js"'
    );
  });

  it("injects window globals reflecting the live basePath regardless of what was baked in", () => {
    const html =
      '<html><head></head><body><script src="/mcp/mcp-use/widgets/kanban-board/index.js"></script></body></html>';

    const result = processWidgetHtml(
      html,
      "kanban-board",
      "http://localhost:3000",
      "/api"
    );

    expect(result).toContain('window.__MCP_BASE_PATH__ = "/api"');
    expect(result).toContain(
      'window.__getFile = (filename) => { return "http://localhost:3000/api/mcp-use/widgets/kanban-board/"+filename }'
    );
  });
});
