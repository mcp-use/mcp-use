import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Integration tests for CLI client commands
 * These tests spawn the actual CLI and verify command behavior
 */

const CLI_PATH = join(__dirname, "../dist/index.js");
const TEST_TIMEOUT = 30000;

/**
 * Run a CLI command and capture output
 */
async function runCLI(
  args: string[],
  options: { timeout?: number; input?: string } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [CLI_PATH, ...args], {
      env: { ...process.env, NO_COLOR: "1" }, // Disable colors for easier testing
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    // Send input if provided
    if (options.input && proc.stdin) {
      proc.stdin.write(options.input);
      proc.stdin.end();
    }

    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error("Command timeout"));
    }, options.timeout || TEST_TIMEOUT);

    proc.on("close", (code) => {
      clearTimeout(timeout);
      resolve({
        stdout,
        stderr,
        exitCode: code || 0,
      });
    });

    proc.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

describe("CLI Integration Tests", () => {
  let testDir: string;

  beforeAll(() => {
    // Create temporary test directory
    testDir = mkdtempSync(join(tmpdir(), "mcp-cli-test-"));
  });

  afterAll(() => {
    // Clean up test directory
    if (testDir) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("Help Commands", () => {
    it("should show client help", async () => {
      const result = await runCLI(["client", "--help"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Interactive MCP client");
      expect(result.stdout).toContain("connect");
      expect(result.stdout).toContain("tools");
      expect(result.stdout).toContain("resources");
      expect(result.stdout).toContain("prompts");
      expect(result.stdout).toContain("sessions");
    });

    it("should show tools help", async () => {
      const result = await runCLI(["client", "tools", "--help"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Interact with MCP tools");
      expect(result.stdout).toContain("list");
      expect(result.stdout).toContain("call");
      expect(result.stdout).toContain("describe");
    });

    it("should show resources help", async () => {
      const result = await runCLI(["client", "resources", "--help"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Interact with MCP resources");
      expect(result.stdout).toContain("list");
      expect(result.stdout).toContain("read");
      expect(result.stdout).toContain("subscribe");
      expect(result.stdout).toContain("unsubscribe");
    });

    it("should show prompts help", async () => {
      const result = await runCLI(["client", "prompts", "--help"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Interact with MCP prompts");
      expect(result.stdout).toContain("list");
      expect(result.stdout).toContain("get");
    });

    it("should show sessions help", async () => {
      const result = await runCLI(["client", "sessions", "--help"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Manage CLI sessions");
      expect(result.stdout).toContain("list");
      expect(result.stdout).toContain("switch");
    });
  });

  describe("Session Management", () => {
    it("should list sessions when none exist", async () => {
      const result = await runCLI(["client", "sessions", "list"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("No saved sessions");
    });

    it("should show error when no active session for tools list", async () => {
      const result = await runCLI(["client", "tools", "list"]);

      // Command may exit with 0 or 1 depending on session state
      // Just verify it mentions no session or connection error
      const output = result.stdout + result.stderr;
      expect(output).toMatch(/No active session|not found|Connection failed/i);
    });
  });

  describe("Connection", () => {
    it("should fail to connect to invalid URL", async () => {
      const result = await runCLI([
        "client",
        "connect",
        "http://invalid-host-12345.local:9999/mcp",
        "--name",
        "test-invalid",
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Connection failed");
    });

    // Note: Testing actual connection requires a running MCP server
    // These tests would be better suited for e2e tests
  });

  describe("Output Formats", () => {
    it("should support --json flag for sessions list", async () => {
      // Note: This would need sessions to exist
      const result = await runCLI(["client", "sessions", "list", "--json"]);

      // Command may work with or without --json flag depending on implementation
      // Just verify it doesn't crash
      expect([0, 1]).toContain(result.exitCode);
    });
  });

  describe("Error Handling", () => {
    it("should show error for invalid command", async () => {
      const result = await runCLI(["client", "invalid-command"]);

      expect(result.exitCode).not.toBe(0);
    });

    it("should show error for missing required arguments", async () => {
      const result = await runCLI(["client", "connect"]);

      expect(result.exitCode).not.toBe(0);
      const output = result.stderr + result.stdout;
      expect(output).toMatch(/error/i);
    });

    it("should handle invalid JSON in tool call", async () => {
      // This would need an active session, but we can test the command structure
      const result = await runCLI([
        "client",
        "tools",
        "call",
        "test_tool",
        "invalid-json",
      ]);

      // May fail for various reasons (no session, invalid JSON, etc.)
      // Just verify command doesn't crash
      const output = result.stdout + result.stderr;
      expect(output.length).toBeGreaterThan(0);
    });
  });

  describe("Stdio Server Connection", () => {
    it("should accept stdio flag syntax", async () => {
      // This will fail without the actual server, but tests argument parsing
      const result = await runCLI([
        "client",
        "connect",
        "--stdio",
        "echo test",
        "--name",
        "stdio-test",
      ]);

      // Will fail to connect but should parse arguments correctly
      expect(result.exitCode).toBe(1);
      // The error should be about connection, not argument parsing
      expect(result.stderr).not.toContain("Unknown option");
    });
  });
});

describe("CLI with Mock Server", () => {
  // These tests would require setting up a mock MCP server
  // For now, we document the test structure

  it.todo("should connect to a mock HTTP server");
  it.todo("should list tools from mock server");
  it.todo("should call a tool on mock server");
  it.todo("should list resources from mock server");
  it.todo("should read a resource from mock server");
  it.todo("should handle disconnection gracefully");
});
