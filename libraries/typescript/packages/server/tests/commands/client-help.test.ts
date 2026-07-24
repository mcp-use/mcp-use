import { afterEach, describe, expect, it, vi } from "vitest";

import { main } from "../../src/bin/main.js";

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
  [["demo", "auth", "logout"], "mcp-use client <name> auth logout [options]"],
];

afterEach(() => vi.restoreAllMocks());

function runClientHelp(argv: readonly string[]): Promise<number> {
  return main(["client", ...argv]);
}

describe("client help tree", () => {
  it.each(helpTree)(
    "prints scoped long and short help for %s",
    async (path, usage) => {
      for (const flag of ["--help", "-h"]) {
        const stdout = vi
          .spyOn(process.stdout, "write")
          .mockImplementation(() => true);
        const stderr = vi
          .spyOn(process.stderr, "write")
          .mockImplementation(() => true);

        await expect(runClientHelp([...path, flag])).resolves.toBe(0);

        const output = stdout.mock.calls.flat().join("");
        expect(output).toContain(`Usage: ${usage}`);
        expect(output).toContain("-h, --help");
        expect(stderr).not.toHaveBeenCalled();
        vi.restoreAllMocks();
      }
    }
  );

  it("resolves leaf help without saved-server or MCP side effects", async () => {
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await expect(
      runClientHelp([
        "--json",
        "not-saved",
        "tools",
        "call",
        "not-a-tool",
        "--help",
      ])
    ).resolves.toBe(0);

    const output = stdout.mock.calls.flat().join("");
    expect(output).toContain(
      "Usage: mcp-use client <name> tools call <tool> [args...] [options]"
    );
    expect(output).toContain("--timeout <ms>");
    expect(output).toContain("--json");
    expect(stderr).not.toHaveBeenCalled();
  });

  it("keeps invalid nested help paths as usage errors", async () => {
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await expect(
      runClientHelp(["demo", "tools", "frobnicate", "--help"])
    ).resolves.toBe(2);

    expect(stdout).not.toHaveBeenCalled();
    expect(stderr.mock.calls.flat().join("")).toContain(
      "Unknown client tools command: frobnicate"
    );
  });

  it("documents current connect and removal behavior", async () => {
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await runClientHelp(["connect", "--help"]);
    const connect = stdout.mock.calls.flat().join("");
    expect(connect).toContain("--protocol <auto|legacy|modern>");
    expect(connect).toContain("--no-open");
    expect(connect).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(connect).not.toContain("  --open");

    stdout.mockClear();
    await runClientHelp(["remove", "--help"]);
    const remove = stdout.mock.calls.flat().join("");
    expect(remove).not.toContain("--yes");
    expect(remove).not.toContain("--json");

    stdout.mockClear();
    await runClientHelp(["demo", "auth", "logout", "--help"]);
    const logout = stdout.mock.calls.flat().join("");
    expect(logout).toContain("--yes");
    expect(logout).toContain("--json");
  });
});
