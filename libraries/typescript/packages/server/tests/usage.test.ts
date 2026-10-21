import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const trackedEnvironment = [
  "MCP_USE_ANONYMIZED_TELEMETRY",
  "MCP_USE_TELEMETRY_PROJECT_ID",
  "MCP_USE_TELEMETRY_VALIDATION_ID",
  "NODE_ENV",
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
  // These cases exercise identity persistence, not the opt-out, so they must
  // not inherit an ambient MCP_USE_ANONYMIZED_TELEMETRY=false. afterEach
  // already restores this variable.
  process.env["MCP_USE_ANONYMIZED_TELEMETRY"] = "true";
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

const BROWSER =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

function landingRequest(
  options: { method?: "GET" | "HEAD"; userAgent?: string; accept?: string } = {}
): Request {
  return new Request("https://server.example.test/mcp", {
    method: options.method ?? "GET",
    headers: {
      accept: options.accept ?? "text/html,application/xhtml+xml",
      ...(options.userAgent !== undefined && {
        "user-agent": options.userAgent,
      }),
    },
  });
}

describe("landing page views", () => {
  // Leave NODE_ENV=test and the validation override behind so the real
  // sampling path runs; Math.random decides whether the 0.1 sample keeps it.
  async function setup(random: number) {
    process.env["MCP_USE_ANONYMIZED_TELEMETRY"] = "true";
    process.env["NODE_ENV"] = "development";
    delete process.env["MCP_USE_TELEMETRY_VALIDATION_ID"];
    process.env["MCP_USE_TELEMETRY_PROJECT_ID"] = "landing-test";
    vi.spyOn(Math, "random").mockReturnValue(random);
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response(null, { status: 202 })
    );
    vi.stubGlobal("fetch", fetch);
    const usage = await import("../src/usage.js");
    const { MCPServer } = await import("../src/index.js");
    const server = new MCPServer({ name: "landing-usage", version: "1.0.0" });
    const events = async () => {
      await usage.flushUsage();
      return fetch.mock.calls.map(
        ([, init]) =>
          JSON.parse(String(init?.body)).properties as Record<string, unknown>
      );
    };
    return { server, events };
  }

  it("records a sampled view of the built-in page", async () => {
    const { server, events } = await setup(0);
    try {
      expect(
        (await server.fetch(landingRequest({ userAgent: BROWSER }))).status
      ).toBe(200);
      expect(await events()).toEqual([
        expect.objectContaining({
          feature: "landing",
          action: "viewed",
          page: "built_in",
          dev: false,
          public_landing: false,
          likely_bot: false,
          sample_rate: 0.1,
        }),
      ]);
    } finally {
      await server.close();
    }
  });

  it("tags a custom development page and flags unfurlers and missing user agents", async () => {
    const { server, events } = await setup(0);
    server.__primeLandingPage({
      dataKeys: [],
      render: () => "<main>Custom</main>",
      entry: "assets/entry.js",
      dev: true,
    });
    try {
      await server.fetch(
        landingRequest({ userAgent: "Slackbot-LinkExpanding 1.0" })
      );
      await server.fetch(landingRequest());
      expect(await events()).toEqual([
        expect.objectContaining({
          page: "custom",
          dev: true,
          likely_bot: true,
        }),
        expect.objectContaining({
          page: "custom",
          dev: true,
          likely_bot: true,
        }),
      ]);
    } finally {
      await server.close();
    }
  });

  it("records nothing when anonymized telemetry is turned off", async () => {
    const { server, events } = await setup(0);
    process.env["MCP_USE_ANONYMIZED_TELEMETRY"] = "false";
    try {
      expect(
        (await server.fetch(landingRequest({ userAgent: BROWSER }))).status
      ).toBe(200);
      expect(await events()).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it("skips HEAD, protocol requests, and views outside the sample", async () => {
    const { server, events } = await setup(0);
    try {
      await server.fetch(
        landingRequest({ method: "HEAD", userAgent: BROWSER })
      );
      await server.fetch(
        landingRequest({ accept: "application/json", userAgent: BROWSER })
      );
      vi.mocked(Math.random).mockReturnValue(0.5);
      await server.fetch(landingRequest({ userAgent: BROWSER }));
      expect(await events()).toEqual([]);
    } finally {
      await server.close();
    }
  });
});
