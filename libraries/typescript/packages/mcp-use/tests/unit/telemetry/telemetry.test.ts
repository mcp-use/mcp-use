/**
 * Tests for the core Telemetry class
 *
 * These tests verify:
 * - Singleton pattern
 * - Environment variable handling
 * - Source configuration
 * - Event capturing
 * - Flush and shutdown behavior
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCapturePostHog = vi.fn().mockResolvedValue(undefined);
const mockCaptureScarf = vi.fn().mockResolvedValue(undefined);

vi.mock("../../../src/telemetry/tel-fetch.js", () => ({
  capturePostHog: (...args: unknown[]) => mockCapturePostHog(...args),
  captureScarf: (...args: unknown[]) => mockCaptureScarf(...args),
  SCARF_GATEWAY_URL: "https://mcpuse.gateway.scarf.sh/events-ts",
}));

// Mock fs module
vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue("test-user-id"),
}));

// Mock os module
vi.mock("node:os", () => ({
  homedir: vi.fn().mockReturnValue("/mock/home"),
}));

describe("Telemetry", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
    // Reset modules to get fresh Telemetry instance
    vi.resetModules();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe("singleton pattern", () => {
    it("should return the same instance on multiple calls", async () => {
      const { Telemetry } =
        await import("../../../src/telemetry/telemetry-node.js");
      const instance1 = Telemetry.getInstance();
      const instance2 = Telemetry.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe("environment variable handling", () => {
    it("should disable telemetry when MCP_USE_ANONYMIZED_TELEMETRY=false", async () => {
      process.env.MCP_USE_ANONYMIZED_TELEMETRY = "false";

      const { Telemetry } =
        await import("../../../src/telemetry/telemetry-node.js");
      const telemetry = Telemetry.getInstance();

      expect(telemetry.isEnabled).toBe(false);
    });

    it("should enable telemetry when MCP_USE_ANONYMIZED_TELEMETRY is not set", async () => {
      delete process.env.MCP_USE_ANONYMIZED_TELEMETRY;

      const { Telemetry } =
        await import("../../../src/telemetry/telemetry-node.js");
      const telemetry = Telemetry.getInstance();

      expect(telemetry.isEnabled).toBe(true);
    });

    it("should use custom source from MCP_USE_TELEMETRY_SOURCE env var", async () => {
      process.env.MCP_USE_TELEMETRY_SOURCE = "custom-source";

      const { Telemetry } =
        await import("../../../src/telemetry/telemetry-node.js");
      const telemetry = Telemetry.getInstance();

      expect(telemetry.getSource()).toBe("custom-source");
    });
  });

  describe("source configuration", () => {
    it("should default source to detected runtime environment", async () => {
      delete process.env.MCP_USE_TELEMETRY_SOURCE;

      const { Telemetry } =
        await import("../../../src/telemetry/telemetry-node.js");
      const telemetry = Telemetry.getInstance();

      // In Node.js test environment, source defaults to "node"
      expect(telemetry.getSource()).toBe("node");
      expect(telemetry.runtimeEnvironment).toBe("node");
    });

    it("should allow setting source via setSource()", async () => {
      const { Telemetry } =
        await import("../../../src/telemetry/telemetry-node.js");
      const telemetry = Telemetry.getInstance();

      telemetry.setSource("my-custom-app");
      expect(telemetry.getSource()).toBe("my-custom-app");
    });
  });

  describe("event capturing", () => {
    it("should not capture events when telemetry is disabled", async () => {
      process.env.MCP_USE_ANONYMIZED_TELEMETRY = "false";

      const { Telemetry } =
        await import("../../../src/telemetry/telemetry-node.js");
      const { ServerToolCallEvent } =
        await import("../../../src/telemetry/events.js");
      const telemetry = Telemetry.getInstance();

      const event = new ServerToolCallEvent({
        toolName: "disabled_tool",
        lengthInputArgument: 0,
        success: true,
      });

      // Should not throw and should complete silently
      await telemetry.capture(event);
    });

    it("should capture events with correct properties when enabled", async () => {
      delete process.env.MCP_USE_ANONYMIZED_TELEMETRY;
      mockCapturePostHog.mockClear();

      const { Telemetry } =
        await import("../../../src/telemetry/telemetry-node.js");
      const { ServerToolCallEvent } =
        await import("../../../src/telemetry/events.js");
      const telemetry = Telemetry.getInstance();

      const event = new ServerToolCallEvent({
        toolName: "test_tool",
        lengthInputArgument: 2,
        success: true,
      });

      await telemetry.capture(event);

      expect(mockCapturePostHog).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "server_tool_call",
          properties: expect.objectContaining({
            tool_name: "test_tool",
            length_input_argument: 2,
            language: "typescript",
          }),
        })
      );
    });
  });

  describe("tracking methods", () => {
    it("should not track when telemetry is disabled", async () => {
      process.env.MCP_USE_ANONYMIZED_TELEMETRY = "false";

      const { Telemetry } =
        await import("../../../src/telemetry/telemetry-node.js");
      const telemetry = Telemetry.getInstance();
      const captureSpy = vi.spyOn(telemetry, "capture");

      await telemetry.trackServerToolCall({
        toolName: "disabled_tool",
        lengthInputArgument: 0,
        success: true,
      });

      expect(captureSpy).not.toHaveBeenCalled();
    });

    it("should call capture for trackServerToolCall when enabled", async () => {
      delete process.env.MCP_USE_ANONYMIZED_TELEMETRY;

      const { Telemetry } =
        await import("../../../src/telemetry/telemetry-node.js");
      const telemetry = Telemetry.getInstance();
      const captureSpy = vi.spyOn(telemetry, "capture").mockResolvedValue();

      await telemetry.trackServerToolCall({
        toolName: "test_tool",
        lengthInputArgument: 100,
        success: true,
        executionTimeMs: 50,
      });

      expect(captureSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "server_tool_call",
        })
      );
    });

    it("should call capture for trackServerResourceCall when enabled", async () => {
      delete process.env.MCP_USE_ANONYMIZED_TELEMETRY;

      const { Telemetry } =
        await import("../../../src/telemetry/telemetry-node.js");
      const telemetry = Telemetry.getInstance();
      const captureSpy = vi.spyOn(telemetry, "capture").mockResolvedValue();

      await telemetry.trackServerResourceCall({
        name: "test_resource",
        description: "A test resource",
        contents: [{ text: "content" }],
        success: true,
      });

      expect(captureSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "server_resource_call",
        })
      );
    });

    it("should call capture for trackServerPromptCall when enabled", async () => {
      delete process.env.MCP_USE_ANONYMIZED_TELEMETRY;

      const { Telemetry } =
        await import("../../../src/telemetry/telemetry-node.js");
      const telemetry = Telemetry.getInstance();
      const captureSpy = vi.spyOn(telemetry, "capture").mockResolvedValue();

      await telemetry.trackServerPromptCall({
        name: "test_prompt",
        description: "A test prompt",
        success: true,
      });

      expect(captureSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "server_prompt_call",
        })
      );
    });

    it("should call capture for trackServerContext when enabled", async () => {
      delete process.env.MCP_USE_ANONYMIZED_TELEMETRY;

      const { Telemetry } =
        await import("../../../src/telemetry/telemetry-node.js");
      const telemetry = Telemetry.getInstance();
      const captureSpy = vi.spyOn(telemetry, "capture").mockResolvedValue();

      await telemetry.trackServerContext({
        contextType: "sample",
      });

      expect(captureSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "server_context_sample",
        })
      );
    });

    it("should call capture for trackServerInitialize when enabled", async () => {
      delete process.env.MCP_USE_ANONYMIZED_TELEMETRY;

      const { Telemetry } =
        await import("../../../src/telemetry/telemetry-node.js");
      const telemetry = Telemetry.getInstance();
      const captureSpy = vi.spyOn(telemetry, "capture").mockResolvedValue();

      await telemetry.trackServerInitialize({
        protocolVersion: "2024-11-05",
        clientInfo: { name: "test-client", version: "1.0.0" },
        clientCapabilities: { tools: {} },
        sessionId: "test-session",
      });

      expect(captureSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "server_initialize_call",
        })
      );
    });
  });

  describe("flush and shutdown", () => {
    it("should no-op flush with fetch-based telemetry", async () => {
      delete process.env.MCP_USE_ANONYMIZED_TELEMETRY;

      const { Telemetry } =
        await import("../../../src/telemetry/telemetry-node.js");
      const telemetry = Telemetry.getInstance();

      expect(() => telemetry.flush()).not.toThrow();
    });

    it("should no-op shutdown with fetch-based telemetry", async () => {
      delete process.env.MCP_USE_ANONYMIZED_TELEMETRY;

      const { Telemetry } =
        await import("../../../src/telemetry/telemetry-node.js");
      const telemetry = Telemetry.getInstance();

      await expect(telemetry.shutdown()).resolves.toBeUndefined();
    });
  });
});
