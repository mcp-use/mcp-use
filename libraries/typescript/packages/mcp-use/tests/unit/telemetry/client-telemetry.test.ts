/**
 * Tests for MCPClient telemetry integration
 *
 * These tests verify that MCPClient correctly triggers telemetry events:
 * - trackMCPClientInit on construction
 * - Correct event data is captured
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Create mock functions for PostHog
const mockCapture = vi.fn();
const mockFlush = vi.fn();
const mockShutdown = vi.fn();

// Mock PostHog before importing Telemetry
vi.mock("posthog-node", () => {
  return {
    PostHog: class MockPostHog {
      capture = mockCapture;
      flush = mockFlush;
      shutdown = mockShutdown;
    },
  };
});

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

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
    delete process.env.MCP_USE_ANONYMIZED_TELEMETRY; // Ensure telemetry is enabled
    vi.clearAllMocks();
    mockCapture.mockClear();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe("trackMCPClientInit", () => {
    it("should track init event on MCPClient construction with no config", async () => {
      const { MCPClient } = await import("../../../src/client.js");

      new MCPClient();

      // Verify telemetry was tracked via PostHog capture
      expect(mockCapture).toHaveBeenCalled();
      const captureCall = mockCapture.mock.calls.find(
        (call) => call[0]?.event === "mcpclient_init"
      );
      expect(captureCall).toBeDefined();
      expect(captureCall[0].properties).toMatchObject({
        code_mode: false,
        sandbox: false,
        all_callbacks: false,
        verify: false,
        servers: [],
        num_servers: 0,
      });
    });

    it("should track init event with codeMode enabled", async () => {
      const { MCPClient } = await import("../../../src/client.js");

      new MCPClient(undefined, { codeMode: true });

      const captureCall = mockCapture.mock.calls.find(
        (call) => call[0]?.event === "mcpclient_init"
      );
      expect(captureCall).toBeDefined();
      expect(captureCall[0].properties).toMatchObject({
        code_mode: true,
      });
    });

    it("should track init event with codeMode config object", async () => {
      const { MCPClient } = await import("../../../src/client.js");

      new MCPClient(undefined, {
        codeMode: {
          enabled: true,
          executor: "vm",
        },
      });

      const captureCall = mockCapture.mock.calls.find(
        (call) => call[0]?.event === "mcpclient_init"
      );
      expect(captureCall).toBeDefined();
      expect(captureCall[0].properties).toMatchObject({
        code_mode: true,
      });
    });

    it("should track init event with config containing servers", async () => {
      const { MCPClient } = await import("../../../src/client.js");

      const config = {
        mcpServers: {
          "server-1": { url: "http://localhost:3001" },
          "server-2": { url: "http://localhost:3002" },
        },
      };

      new MCPClient(config);

      const captureCall = mockCapture.mock.calls.find(
        (call) => call[0]?.event === "mcpclient_init"
      );
      expect(captureCall).toBeDefined();
      expect(captureCall[0].properties).toMatchObject({
        code_mode: false,
        sandbox: false,
        all_callbacks: false,
        verify: false,
        servers: ["server-1", "server-2"],
        num_servers: 2,
      });
    });

    it("should track init event with sampling callback", async () => {
      const { MCPClient } = await import("../../../src/client.js");

      const samplingCallback = vi.fn();
      new MCPClient(undefined, { samplingCallback });

      const captureCall = mockCapture.mock.calls.find(
        (call) => call[0]?.event === "mcpclient_init"
      );
      expect(captureCall).toBeDefined();
      expect(captureCall[0].properties).toMatchObject({
        all_callbacks: false, // Only sampling, not elicitation
      });
    });

    it("should track init event with elicitation callback", async () => {
      const { MCPClient } = await import("../../../src/client.js");

      const elicitationCallback = vi.fn();
      new MCPClient(undefined, { elicitationCallback });

      const captureCall = mockCapture.mock.calls.find(
        (call) => call[0]?.event === "mcpclient_init"
      );
      expect(captureCall).toBeDefined();
      expect(captureCall[0].properties).toMatchObject({
        all_callbacks: false, // Only elicitation, not sampling
      });
    });

    it("should track init event with all callbacks", async () => {
      const { MCPClient } = await import("../../../src/client.js");

      const samplingCallback = vi.fn();
      const elicitationCallback = vi.fn();
      new MCPClient(undefined, { samplingCallback, elicitationCallback });

      const captureCall = mockCapture.mock.calls.find(
        (call) => call[0]?.event === "mcpclient_init"
      );
      expect(captureCall).toBeDefined();
      expect(captureCall[0].properties).toMatchObject({
        all_callbacks: true,
      });
    });

    it("should use fromDict static method and track init", async () => {
      const { MCPClient } = await import("../../../src/client.js");

      const config = {
        mcpServers: {
          "test-server": { command: "node", args: ["server.js"] },
        },
      };

      MCPClient.fromDict(config);

      const captureCall = mockCapture.mock.calls.find(
        (call) => call[0]?.event === "mcpclient_init"
      );
      expect(captureCall).toBeDefined();
      expect(captureCall[0].properties).toMatchObject({
        code_mode: false,
        sandbox: false,
        all_callbacks: false,
        verify: false,
        servers: ["test-server"],
        num_servers: 1,
      });
    });
  });
});
