import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { test } from "../helpers/cli-test.js";

const helpTree: readonly [path: readonly string[], usage: string][] = [
  [[], "mcp-use client <command>"],
  [["connect"], "mcp-use client connect <name> <url> [options]"],
  [["list"], "mcp-use client list [options]"],
  [["remove"], "mcp-use client remove <name> [options]"],
  [["demo"], "mcp-use client <name> <command>"],
  [["demo", "tools"], "mcp-use client <name> tools <command>"],
  [["demo", "tools", "list"], "mcp-use client <name> tools list [options]"],
  [
    ["demo", "tools", "describe"],
    "mcp-use client <name> tools describe <tool> [options]",
  ],
  [
    ["demo", "tools", "call"],
    "mcp-use client <name> tools call <tool> [args...] [options]",
  ],
  [["demo", "resources"], "mcp-use client <name> resources <command>"],
  [
    ["demo", "resources", "list"],
    "mcp-use client <name> resources list [options]",
  ],
  [
    ["demo", "resources", "read"],
    "mcp-use client <name> resources read <uri> [options]",
  ],
  [["demo", "prompts"], "mcp-use client <name> prompts <command>"],
  [["demo", "prompts", "list"], "mcp-use client <name> prompts list [options]"],
  [
    ["demo", "prompts", "get"],
    "mcp-use client <name> prompts get <prompt> [args...] [options]",
  ],
  [["demo", "auth"], "mcp-use client <name> auth <command>"],
  [["demo", "auth", "status"], "mcp-use client <name> auth status [options]"],
  [["demo", "auth", "login"], "mcp-use client <name> auth login [options]"],
  [["demo", "auth", "logout"], "mcp-use client <name> auth logout [options]"],
];

describe("client help tree", () => {
  test.for(
    helpTree.flatMap(([path, usage]) =>
      ["--help", "-h"].map((flag) => [[...path, flag], usage] as const)
    )
  )("mcp-use client %s prints scoped help", async ([args, usage], { cli }) => {
    const result = await cli.run(["client", ...args]);

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.startsWith(`Usage: ${usage}\n`)).toBe(true);
    expect(result.stdout).toContain("-h, --help");
  });

  test("resolves leaf help without touching saved servers", async ({ cli }) => {
    const result = await cli.run([
      "client",
      "--json",
      "not-saved",
      "tools",
      "call",
      "not-a-tool",
      "--help",
    ]);

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "Usage: mcp-use client <name> tools call <tool> [args...] [options]"
    );
    expect(result.stdout).toContain("--timeout <ms>");
    expect(existsSync(join(cli.home, ".mcp-use"))).toBe(false);
  });

  test("keeps invalid nested help paths as usage errors", async ({ cli }) => {
    const result = await cli.run([
      "client",
      "demo",
      "tools",
      "frobnicate",
      "--help",
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Unknown client tools command: frobnicate");
  });

  test("documents current connect and removal options", async ({ cli }) => {
    const connect = (await cli.run(["client", "connect", "--help"])).stdout;
    expect(connect).toContain("--protocol <auto|legacy|modern>");
    expect(connect).toContain("--no-open");
    expect(connect).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(connect).not.toContain("  --open");

    const remove = (await cli.run(["client", "remove", "--help"])).stdout;
    expect(remove).not.toContain("--yes");
    expect(remove).toContain("--json");

    const logout = (
      await cli.run(["client", "demo", "auth", "logout", "--help"])
    ).stdout;
    expect(logout).toContain("--yes");
    expect(logout).toContain("--json");
  });
});
