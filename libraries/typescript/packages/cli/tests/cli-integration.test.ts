import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import {
  writeFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Integration tests for CLI client commands
 * These tests spawn the actual CLI and verify command behavior
 */

const CLI_PATH = join(__dirname, "../dist/index.cjs");
const TEST_TIMEOUT = 30000;

// Isolated HOME so spawned CLI subprocesses never read or write the real
// ~/.mcp-use directory while tests run.
const FAKE_HOME = mkdtempSync(join(tmpdir(), "mcp-cli-home-"));

/**
 * Run a CLI command and capture output
 */
async function runCLI(
  args: string[],
  options: { timeout?: number; input?: string } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [CLI_PATH, ...args], {
      env: {
        ...process.env,
        NO_COLOR: "1", // Disable colors for easier testing
        HOME: FAKE_HOME,
        USERPROFILE: FAKE_HOME,
      },
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
    rmSync(FAKE_HOME, { recursive: true, force: true });
  });

  describe("Help Commands", () => {
    it("should show client help", async () => {
      const result = await runCLI(["client", "--help"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Interactive MCP client");
      expect(result.stdout).toContain("connect");
      expect(result.stdout).toContain("list");
    });

    it("should show per-client tools help", async () => {
      const result = await runCLI(["client", "ci-test", "tools", "--help"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Interact with MCP tools");
      expect(result.stdout).toContain("list");
      expect(result.stdout).toContain("call");
      expect(result.stdout).toContain("describe");
    });

    it("should show per-client resources help", async () => {
      const result = await runCLI(["client", "ci-test", "resources", "--help"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Interact with MCP resources");
      expect(result.stdout).toContain("list");
      expect(result.stdout).toContain("read");
      expect(result.stdout).toContain("subscribe");
      expect(result.stdout).toContain("unsubscribe");
    });

    it("should show per-client prompts help", async () => {
      const result = await runCLI(["client", "ci-test", "prompts", "--help"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Interact with MCP prompts");
      expect(result.stdout).toContain("list");
      expect(result.stdout).toContain("get");
    });
  });

  describe("Server Management", () => {
    it("should list servers when none exist", async () => {
      const result = await runCLI(["client", "list"]);

      // Non-TTY (piped) stdout: gh-style empty output, just a clean exit.
      // Decorative "No saved servers" message is suppressed for agents/scripts.
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("");
    });

    it("should error when invoking tools on an unknown server", async () => {
      const result = await runCLI([
        "client",
        "does-not-exist",
        "tools",
        "list",
      ]);

      expect(result.exitCode).toBe(1);
      const output = result.stdout + result.stderr;
      expect(output).toMatch(/not found|Connection failed/i);
    });

    it("should suggest connect when bare `client <name>` targets an unknown server", async () => {
      const result = await runCLI(["client", "does-not-exist"]);

      expect(result.exitCode).toBe(1);
      const output = result.stdout + result.stderr;
      expect(output).toMatch(/Server 'does-not-exist' not found/);
      expect(output).toContain("mcp-use client connect does-not-exist <url>");
      // The per-server commander help leaks subcommand names like "tools",
      // "resources", "prompts" — make sure we suppressed it for an unknown
      // server. ("Commands:" is commander's help section header.)
      expect(output).not.toMatch(/^Commands:/m);
    });

    it("should also suggest connect when `client <name> --help` targets an unknown server", async () => {
      const result = await runCLI(["client", "does-not-exist", "--help"]);

      expect(result.exitCode).toBe(1);
      const output = result.stdout + result.stderr;
      expect(output).toMatch(/Server 'does-not-exist' not found/);
      expect(output).toContain("mcp-use client connect does-not-exist <url>");
    });

    describe("remove", () => {
      // Write the sessions file directly so we don't need a live MCP server
      // just to test the remove path.
      const sessionsFile = join(FAKE_HOME, ".mcp-use", "cli-sessions.json");

      function writeSessions(sessions: Record<string, unknown>) {
        mkdirSync(join(FAKE_HOME, ".mcp-use"), { recursive: true });
        writeFileSync(
          sessionsFile,
          JSON.stringify({ sessions }, null, 2),
          "utf-8"
        );
      }

      function readSessions(): Record<string, unknown> {
        return JSON.parse(readFileSync(sessionsFile, "utf-8")).sessions ?? {};
      }

      it("removes a saved server", async () => {
        writeSessions({
          "to-remove": {
            type: "http",
            url: "http://localhost:3000/mcp",
            authMode: "bearer",
            lastUsed: new Date().toISOString(),
          },
          keeper: {
            type: "http",
            url: "http://localhost:4000/mcp",
            authMode: "bearer",
            lastUsed: new Date().toISOString(),
          },
        });

        const result = await runCLI(["client", "remove", "to-remove"]);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toMatch(/Removed saved server 'to-remove'/);

        const remaining = readSessions();
        expect(remaining["to-remove"]).toBeUndefined();
        expect(remaining["keeper"]).toBeDefined();
      });

      it("errors when the server does not exist", async () => {
        writeSessions({});

        const result = await runCLI(["client", "remove", "ghost"]);

        expect(result.exitCode).toBe(1);
        const output = result.stdout + result.stderr;
        expect(output).toMatch(/Server 'ghost' not found/);
        expect(output).toContain("mcp-use client list");
      });

      it("clears OAuth tokens when no other saved server uses the URL", async () => {
        writeSessions({
          "oauth-srv": {
            type: "http",
            url: "https://example.com/mcp",
            authMode: "oauth",
            lastUsed: new Date().toISOString(),
          },
        });

        const result = await runCLI(["client", "remove", "oauth-srv"]);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toMatch(/Removed saved server 'oauth-srv'/);
        expect(result.stdout).toMatch(
          /Removed OAuth tokens for https:\/\/example\.com\/mcp/
        );
        expect(readSessions()["oauth-srv"]).toBeUndefined();
      });

      it("keeps OAuth tokens when another saved server shares the URL", async () => {
        writeSessions({
          "oauth-srv": {
            type: "http",
            url: "https://example.com/mcp",
            authMode: "oauth",
            lastUsed: new Date().toISOString(),
          },
          "oauth-backup": {
            type: "http",
            url: "https://example.com/mcp",
            authMode: "oauth",
            lastUsed: new Date().toISOString(),
          },
        });

        const result = await runCLI(["client", "remove", "oauth-srv"]);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toMatch(/Removed saved server 'oauth-srv'/);
        expect(result.stdout).toMatch(
          /OAuth tokens .* were kept because saved server 'oauth-backup' still uses that URL/
        );
        const remaining = readSessions();
        expect(remaining["oauth-srv"]).toBeUndefined();
        expect(remaining["oauth-backup"]).toBeDefined();
      });
    });
  });

  describe("Connection", () => {
    it("should fail to connect to invalid URL", async () => {
      const result = await runCLI([
        "client",
        "connect",
        "test-invalid",
        "http://invalid-host-12345.local:9999/mcp",
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Connection failed");
    });

    // Note: Testing actual connection requires a running MCP server
    // These tests would be better suited for e2e tests
  });

  describe("Error Handling", () => {
    it("should show error for missing required arguments", async () => {
      const result = await runCLI(["client", "connect"]);

      expect(result.exitCode).not.toBe(0);
      const output = result.stderr + result.stdout;
      expect(output).toMatch(/error/i);
    });

    it("should error when connect is missing the url positional", async () => {
      const result = await runCLI(["client", "connect", "only-name"]);

      expect(result.exitCode).not.toBe(0);
      const output = result.stderr + result.stdout;
      expect(output).toMatch(/error/i);
      expect(output).toMatch(/Missing <url>/i);
      expect(output).toContain("mcp-use client connect only-name <url>");
    });

    it("should explain that a name is needed when only a URL is provided", async () => {
      const result = await runCLI([
        "client",
        "connect",
        "https://mcp.example.com/mcp",
      ]);

      expect(result.exitCode).not.toBe(0);
      const output = result.stderr + result.stdout;
      expect(output).toMatch(/Missing server name/i);
      expect(output).toContain("https://mcp.example.com/mcp");
      expect(output).toMatch(/mcp-use client connect <name>/i);
    });

    it("should handle invalid JSON in tool call", async () => {
      // Goes through the per-server routing even though the server doesn't
      // exist — just verifies the command structure parses.
      const result = await runCLI([
        "client",
        "ci-test",
        "tools",
        "call",
        "test_tool",
        "invalid-json",
      ]);

      const output = result.stdout + result.stderr;
      expect(output.length).toBeGreaterThan(0);
    });
  });

  describe("Stdio Server Connection", () => {
    it("should accept stdio flag syntax", async () => {
      const result = await runCLI([
        "client",
        "connect",
        "stdio-test",
        "echo test",
        "--stdio",
      ]);

      // Will fail to connect but should parse arguments correctly.
      expect(result.exitCode).toBe(1);
      expect(result.stderr).not.toContain("Unknown option");
    });
  });
});

describe("Build command — import resolution", () => {
  let buildDir: string;

  beforeAll(() => {
    buildDir = mkdtempSync(join(tmpdir(), "mcp-cli-build-test-"));
  });

  afterAll(() => {
    if (buildDir) {
      rmSync(buildDir, { recursive: true, force: true });
    }
  });

  // Regression test for MCP-1733. Validates both knobs of the esbuild
  // config in transpileWithEsbuild: `bundle: true` resolves extensionless
  // relative imports at build time, `packages: "external"` keeps third-party
  // imports as runtime specifiers. Entry is named `main.ts` (not `index.ts`)
  // so findServerFile doesn't match and the tool-registry type gen step is
  // skipped — isolating the test to the esbuild change.
  it(
    "inlines extensionless relative imports and keeps bare package imports external",
    async () => {
      mkdirSync(join(buildDir, "src"), { recursive: true });
      writeFileSync(
        join(buildDir, "package.json"),
        JSON.stringify({
          name: "build-import-resolution-fixture",
          version: "0.0.0",
          type: "module",
        })
      );
      writeFileSync(
        join(buildDir, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "bundler",
            strict: true,
            outDir: "./dist",
            rootDir: "./src",
            skipLibCheck: true,
            esModuleInterop: true,
          },
          include: ["src/**/*.ts"],
        })
      );
      writeFileSync(
        join(buildDir, "src/utils.ts"),
        `export function greet(name: string): string {
  return \`hello from \${name}\`;
}
`
      );
      writeFileSync(
        join(buildDir, "src/main.ts"),
        `import { MCPServer } from "mcp-use";
import { greet } from "./utils";

export const server = MCPServer;
export const message = greet("mcp-1733");
`
      );

      const result = await runCLI(["build", "-p", buildDir, "--no-typecheck"]);
      expect(result.exitCode).toBe(0);

      const bundled = readFileSync(join(buildDir, "dist/main.js"), "utf8");

      // Bare package import must survive to runtime (packages: "external").
      expect(bundled).toMatch(/from\s+["']mcp-use["']/);

      // Relative extensionless import must be inlined (bundle: true):
      // the import itself is gone, and the utils body is present.
      expect(bundled).not.toMatch(/from\s+["']\.\/utils["']/);
      expect(bundled).toContain("hello from ");
    },
    TEST_TIMEOUT
  );
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
