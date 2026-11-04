import { describe, expect } from "vitest";

import { test } from "./helpers/cli-test.js";

// Help must work offline. The API key means any Cloud call would reach the
// fake Cloud, which fails the test for every request it receives.
const SIGNED_IN = { MCP_USE_API_KEY: "test_key" };

describe("offline help contract", () => {
  test.for([
    ["login", ["login", "--help"]],
    ["logout", ["logout", "--help"]],
    ["whoami", ["whoami", "-h"]],
    ["org", ["org", "--help"]],
    ["org list", ["org", "list", "--help"]],
    ["org current", ["org", "current", "--help"]],
    ["org use", ["org", "use", "--help"]],
    ["servers", ["servers", "--help"]],
    ["servers list", ["servers", "list", "--help"]],
    ["servers get", ["servers", "get", "--help"]],
    ["servers update", ["servers", "update", "--help"]],
    ["servers delete", ["servers", "delete", "--help"]],
    ["servers env", ["servers", "env", "--help"]],
    ["servers env list", ["servers", "env", "list", "--help"]],
    ["servers env set", ["servers", "env", "set", "-h"]],
    ["servers env unset", ["servers", "env", "unset", "--help"]],
    ["deployments", ["deployments", "--help"]],
    ["deployments list", ["deployments", "list", "--help"]],
    ["deployments get", ["deployments", "get", "--help"]],
    ["deployments logs", ["deployments", "logs", "-h"]],
    ["deployments restart", ["deployments", "restart", "--help"]],
    ["deployments stop", ["deployments", "stop", "--help"]],
    ["deployments delete", ["deployments", "delete", "--help"]],
    ["screenshot", ["screenshot", "--help"]],
    ["client", ["client", "--help"]],
    ["client", ["client", "--", "--help"]],
  ] as const)(
    "mcp-use %s prints its own usage",
    async ([name, args], { cli }) => {
      const result = await cli.run(args, { env: SIGNED_IN });

      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
      expect(result.stdout.startsWith(`Usage: mcp-use ${name} `)).toBe(true);
    }
  );

  test.for(["dev", "build", "typecheck", "start"])(
    "mcp-use %s --help prints command help, not the command list",
    async (command, { cli }) => {
      const result = await cli.run([command, "--help"]);

      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
      expect(result.stdout.startsWith(`Usage: mcp-use ${command} `)).toBe(true);
      expect(result.stdout).not.toContain("Commands:");
    }
  );

  test("build --help documents --inline", async ({ cli }) => {
    const result = await cli.run(["build", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^\s+--inline\s/m);
  });

  test("--help lists every top-level command", async ({ cli }) => {
    const result = await cli.run(["--help"]);

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    for (const command of [
      "dev",
      "build",
      "start",
      "typecheck",
      "client",
      "screenshot",
      "login",
      "deploy",
      "deployments",
      "servers",
    ]) {
      expect(result.stdout).toMatch(new RegExp(`^ {2}${command} `, "m"));
    }
  });
});

describe("unusable invocations", () => {
  test("no command prints usage to stderr and exits 2", async ({ cli }) => {
    const result = await cli.run([]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Usage: mcp-use <command>");
  });

  test("an unknown command is named on stderr and exits 2", async ({ cli }) => {
    const result = await cli.run(["frobnicate"]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr.startsWith("Unknown command: frobnicate\n")).toBe(
      true
    );
  });
});
