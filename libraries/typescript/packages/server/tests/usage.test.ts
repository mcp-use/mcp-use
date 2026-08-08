import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const trackedEnvironment = [
  "MCP_USE_ANONYMIZED_TELEMETRY",
  "MCP_USE_TELEMETRY_PROJECT_ID",
  "MCP_USE_TELEMETRY_VALIDATION_ID",
] as const;

const originalEnvironment = new Map(
  trackedEnvironment.map((name) => [name, process.env[name]])
);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  for (const name of trackedEnvironment) {
    const value = originalEnvironment.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

async function capture(root: string): Promise<void> {
  process.env["MCP_USE_TELEMETRY_VALIDATION_ID"] = "usage-test";
  const fetch = vi.fn(async () => new Response(null, { status: 202 }));
  vi.stubGlobal("fetch", fetch);
  const usage = await import("../src/usage.js");
  usage.recordUsage("runtime", "test", {}, { serverRoot: root });
  await usage.flushUsage();
  expect(fetch).toHaveBeenCalledOnce();
}

describe("usage identity runtime capability", () => {
  it("persists the anonymous identity for a Node filesystem runtime", async () => {
    const root = await mkdtemp(join(tmpdir(), "mcp-use-usage-node-"));
    try {
      await capture(root);
      expect(existsSync(join(root, ".mcp-use", "usage.json"))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not write a project identity in a Deno-style runtime", async () => {
    const root = await mkdtemp(join(tmpdir(), "mcp-use-usage-deno-"));
    try {
      vi.stubGlobal("Deno", {});
      await capture(root);
      expect(existsSync(join(root, ".mcp-use", "usage.json"))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses the explicit project identity without writing runtime state", async () => {
    const root = await mkdtemp(join(tmpdir(), "mcp-use-usage-project-"));
    try {
      process.env["MCP_USE_TELEMETRY_PROJECT_ID"] = "project-identity";
      await capture(root);
      expect(existsSync(join(root, ".mcp-use", "usage.json"))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
