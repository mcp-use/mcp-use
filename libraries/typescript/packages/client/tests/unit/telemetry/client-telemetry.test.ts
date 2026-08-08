/**
 * Tests for MCPClient telemetry integration
 *
 * These tests verify that MCPClient correctly triggers telemetry events:
 * - trackMCPClientInit on construction
 * - Correct event data is captured
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Telemetry now posts events to PostHog via `fetch` (no posthog-node SDK).
// Mock global fetch and inspect the posted event bodies.
const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));

/**
 * Find the PostHog capture whose posted body has the given event name and
 * return the parsed `{ event, properties, distinct_id }` body.
 */
function findCapturedEvent(eventName: string): any {
  for (const call of fetchMock.mock.calls) {
    const init = call[1] as RequestInit | undefined;
    if (!init?.body || typeof init.body !== "string") continue;
    try {
      const parsed = JSON.parse(init.body);
      if (parsed?.event === eventName) return parsed;
    } catch {
      // not a JSON telemetry body
    }
  }
  return undefined;
}

// Mock fs module for config loading
vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
}));

// Mock os module
vi.mock("node:os", () => ({
  homedir: vi.fn().mockReturnValue("/mock/home"),
}));

// Mock path module
vi.mock("node:path", () => ({
  dirname: vi.fn().mockReturnValue("/mock"),
  join: vi.fn((...args) => args.join("/")),
  default: {
    dirname: vi.fn().mockReturnValue("/mock"),
    join: vi.fn((...args) => args.join("/")),
  },
}));

describe("MCPClient Telemetry Integration", () => {
  let originalEnv: NodeJS.ProcessEnv;

  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
    delete process.env.MCP_USE_ANONYMIZED_TELEMETRY; // Ensure telemetry is enabled
    vi.resetModules();
    vi.clearAllMocks();
    fetchMock.mockClear();
    originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  describe("trackMCPClientInit", () => {
    it("should track init event on MCPClient construction with no config", async () => {
      const { MCPClient } = await import("../../../src/core/node.js");

      new MCPClient();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify telemetry was tracked via a PostHog fetch capture
      expect(fetchMock).toHaveBeenCalled();
      const captureCall = findCapturedEvent("mcpclient_init");
      expect(captureCall).toBeDefined();
      expect(captureCall.properties).toMatchObject({
        code_mode: false,
        sandbox: false,
        all_callbacks: false,
        verify: false,
        num_servers: 0,
      });
      expect(captureCall.properties).not.toHaveProperty("servers");
    });

    it("should track init event with codeMode enabled", async () => {
      const { MCPClient } = await import("../../../src/core/node.js");

      new MCPClient(undefined, { codeMode: true });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const captureCall = findCapturedEvent("mcpclient_init");
      expect(captureCall).toBeDefined();
      expect(captureCall.properties).toMatchObject({
        code_mode: true,
      });
    });

    it("should track init event with codeMode config object", async () => {
      const { MCPClient } = await import("../../../src/core/node.js");

      new MCPClient(undefined, {
        codeMode: {
          enabled: true,
          executor: "vm",
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const captureCall = findCapturedEvent("mcpclient_init");
      expect(captureCall).toBeDefined();
      expect(captureCall.properties).toMatchObject({
        code_mode: true,
      });
    });

    it("should track init event with config containing servers", async () => {
      const { MCPClient } = await import("../../../src/core/node.js");

      const config = {
        mcpServers: {
          "server-1": { url: "http://localhost:3001" },
          "server-2": { url: "http://localhost:3002" },
        },
      };

      new MCPClient(config);
      await new Promise((resolve) => setTimeout(resolve, 100));

      const captureCall = findCapturedEvent("mcpclient_init");
      expect(captureCall).toBeDefined();
      expect(captureCall.properties).toMatchObject({
        code_mode: false,
        sandbox: false,
        all_callbacks: false,
        verify: false,
        num_servers: 2,
      });
      expect(JSON.stringify(captureCall.properties)).not.toContain("server-1");
      expect(JSON.stringify(captureCall.properties)).not.toContain("server-2");
    });

    it("should track init event with sampling callback", async () => {
      const { MCPClient } = await import("../../../src/core/node.js");

      const onSampling = vi.fn();
      new MCPClient(undefined, { onSampling });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const captureCall = findCapturedEvent("mcpclient_init");
      expect(captureCall).toBeDefined();
      expect(captureCall.properties).toMatchObject({
        all_callbacks: false, // Only sampling, not elicitation
      });
    });

    it("should track init event with elicitation callback", async () => {
      const { MCPClient } = await import("../../../src/core/node.js");

      const onElicitation = vi.fn();
      new MCPClient(undefined, { onElicitation });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const captureCall = findCapturedEvent("mcpclient_init");
      expect(captureCall).toBeDefined();
      expect(captureCall.properties).toMatchObject({
        all_callbacks: false, // Only elicitation, not sampling
      });
    });

    it("should track init event with all callbacks", async () => {
      const { MCPClient } = await import("../../../src/core/node.js");

      const onSampling = vi.fn();
      const onElicitation = vi.fn();
      new MCPClient(undefined, { onSampling, onElicitation });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const captureCall = findCapturedEvent("mcpclient_init");
      expect(captureCall).toBeDefined();
      expect(captureCall.properties).toMatchObject({
        all_callbacks: true,
      });
    });

    it("should use fromDict static method and track init", async () => {
      const { MCPClient } = await import("../../../src/core/node.js");

      const config = {
        mcpServers: {
          "test-server": { command: "node", args: ["server.js"] },
        },
      };

      MCPClient.fromDict(config);
      await new Promise((resolve) => setTimeout(resolve, 100));

      const captureCall = findCapturedEvent("mcpclient_init");
      expect(captureCall).toBeDefined();
      expect(captureCall.properties).toMatchObject({
        code_mode: false,
        sandbox: false,
        all_callbacks: false,
        verify: false,
        num_servers: 1,
      });
      expect(JSON.stringify(captureCall.properties)).not.toContain(
        "test-server"
      );
    });
  });
});
