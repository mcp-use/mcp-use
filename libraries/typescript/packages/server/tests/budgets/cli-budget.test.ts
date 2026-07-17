import { readdir, readFile, stat } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const DIST = new URL("../../dist/", import.meta.url);

/** Static import patterns that must never appear in edge-safe entrypoints. */
const EDGE_FORBIDDEN_STATIC = [
  { label: "command chunks", pattern: /\bfrom\s+["'][^"']*commands\// },
  { label: "vite toolchain", pattern: /\bfrom\s+["'](?:vite|@vitejs\/)/ },
  {
    label: "vite side-effect import",
    pattern: /\bimport\s+["'](?:vite|@vitejs\/)/,
  },
  { label: "@mcp-use/client", pattern: /\bfrom\s+["']@mcp-use\/client["']/ },
  { label: "v1 MCP SDK", pattern: /\bfrom\s+["']@modelcontextprotocol\/sdk/ },
  { label: "express", pattern: /\bfrom\s+["']express["']/ },
  { label: "node: scheme", pattern: /\bfrom\s+["']node:/ },
  {
    label: "node builtins",
    pattern:
      /\bfrom\s+["'](?:fs|fs\/promises|path|stream|child_process|crypto|os|http|https|net|tls|util|buffer|process)["']/,
  },
] as const;

/** `mcp-use start` is Node-only but must not pull toolchain or other commands. */
const START_FORBIDDEN_STATIC = [
  { label: "command chunks", pattern: /\bfrom\s+["'][^"']*commands\// },
  { label: "vite toolchain", pattern: /\bfrom\s+["'](?:vite|@vitejs\/)/ },
  {
    label: "vite side-effect import",
    pattern: /\bimport\s+["'](?:vite|@vitejs\/)/,
  },
  { label: "@mcp-use/client", pattern: /\bfrom\s+["']@mcp-use\/client["']/ },
  { label: "v1 MCP SDK", pattern: /\bfrom\s+["']@modelcontextprotocol\/sdk/ },
  { label: "express", pattern: /\bfrom\s+["']express["']/ },
] as const;

describe("published CLI boundaries", () => {
  it("keeps dist/index.js free of static node and toolchain leaks", async () => {
    const index = await readFile(new URL("index.js", DIST), "utf8");

    for (const { label, pattern } of EDGE_FORBIDDEN_STATIC) {
      expect(index, `index.js must not statically import ${label}`).not.toMatch(
        pattern
      );
    }

    expect(index, "listen() must lazy-load the Node HTTP adapter").toMatch(
      /\bimport\s*\(\s*["'][^"']*node-bridge[^"']*["']\s*\)/
    );

    expect(index, "public assets must lazy-load filesystem helpers").toMatch(
      /\bimport\s*\(\s*["'](?:node:)?path["']\s*\)/
    );
    expect(index).toMatch(
      /\bimport\s*\(\s*["'][^"']*public-route[^"']*["']\s*\)/
    );
  });

  it("keeps dist/commands/start.js free of toolchain and cross-command leaks", async () => {
    const start = await readFile(new URL("commands/start.js", DIST), "utf8");

    for (const { label, pattern } of START_FORBIDDEN_STATIC) {
      expect(start, `start.js must not statically import ${label}`).not.toMatch(
        pattern
      );
    }
  });

  it("dispatches every substantial command through a dynamic chunk", async () => {
    const bin = await readFile(new URL("bin.js", DIST), "utf8");
    for (const command of [
      "start",
      "dev",
      "build",
      "identity",
      "organizations",
      "servers",
      "deployments",
      "deploy",
      "client",
      "screenshot",
      "skills",
    ]) {
      expect(bin).toContain(`import("./commands/${command}.js")`);
    }
  });

  it("keeps dist/index.js under sixty-two KiB", async () => {
    const bytes = (await stat(new URL("index.js", DIST))).size;
    // The landing renderer is a lazy sibling entry; the root pays only for
    // HTML negotiation and auth-aware route dispatch.
    expect(bytes).toBeLessThanOrEqual(62 * 1024);
  });

  it("keeps the unpacked framework artifact below five MiB", async () => {
    expect(await directoryBytes(DIST)).toBeLessThanOrEqual(5 * 1024 * 1024);
  });
});

async function directoryBytes(directory: URL): Promise<number> {
  let bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = new URL(entry.name, directory);
    if (entry.isDirectory()) {
      bytes += await directoryBytes(new URL(`${entry.name}/`, directory));
    } else {
      bytes += (await stat(path)).size;
    }
  }
  return bytes;
}
