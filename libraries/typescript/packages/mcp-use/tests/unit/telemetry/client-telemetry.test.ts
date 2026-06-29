/**
 * Tests for MCPClient telemetry integration
 *
 * These tests verify that MCPClient correctly triggers telemetry events:
 * - trackMCPClientInit on construction
 * - Correct event data is captured
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  expectPostHogEvent,
  installTelemetryFetchMock,
  restoreTelemetryFetchMock,
} from "./telemetry-test-utils.js";

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
    vi.resetModules();
    vi.clearAllMocks();
    installTelemetryFetchMock();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    restoreTelemetryFetchMock();
    vi.clearAllMocks();
  });

  describe("trackMCPClientInit", () => {
    it("should track init event on MCPClient construction with no config", async () => {
      const { MCPClient } = await import("../../../src/client.js");

      new MCPClient();

      const event = await expectPostHogEvent("mcpclient_init");
      expect(event.properties).toMatchObject({
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

      const event = await expectPostHogEvent("mcpclient_init");
      expect(event.properties).toMatchObject({
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

      const event = await expectPostHogEvent("mcpclient_init");
      expect(event.properties).toMatchObject({
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

      const event = await expectPostHogEvent("mcpclient_init");
      expect(event.properties).toMatchObject({
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

      const onSampling = vi.fn();
      new MCPClient(undefined, { onSampling });

      const event = await expectPostHogEvent("mcpclient_init");
      expect(event.properties).toMatchObject({
        all_callbacks: false, // Only sampling, not elicitation
      });
    });

    it("should track init event with elicitation callback", async () => {
      const { MCPClient } = await import("../../../src/client.js");

      const onElicitation = vi.fn();
      new MCPClient(undefined, { onElicitation });

      const event = await expectPostHogEvent("mcpclient_init");
      expect(event.properties).toMatchObject({
        all_callbacks: false, // Only elicitation, not sampling
      });
    });

    it("should track init event with all callbacks", async () => {
      const { MCPClient } = await import("../../../src/client.js");

      const onSampling = vi.fn();
      const onElicitation = vi.fn();
      new MCPClient(undefined, { onSampling, onElicitation });

      const event = await expectPostHogEvent("mcpclient_init");
      expect(event.properties).toMatchObject({
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

      const event = await expectPostHogEvent("mcpclient_init");
      expect(event.properties).toMatchObject({
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
