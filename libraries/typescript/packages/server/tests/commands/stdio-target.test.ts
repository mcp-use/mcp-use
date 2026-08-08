import { describe, expect, it } from "vitest";

import {
  formatStdioTarget,
  parseStdioTarget,
} from "../../src/commands/stdio-target.js";

describe("parseStdioTarget", () => {
  it("keeps simple stdio commands unchanged", () => {
    expect(
      parseStdioTarget("npx -y @modelcontextprotocol/server-filesystem /tmp")
    ).toEqual({
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
    });
  });

  it("preserves quoted command paths and arguments with spaces", () => {
    expect(
      parseStdioTarget('"/opt/MCP Servers/server" "--config=dev env.json"')
    ).toEqual({
      command: "/opt/MCP Servers/server",
      args: ["--config=dev env.json"],
    });
  });

  it('preserves Windows paths when using quote delimiters (not \\")', () => {
    // Quote characters delimit the token. Backslash-escaped quotes outside a
    // quoted region are literal '"' characters and would still split on spaces.
    const target = String.raw`"C:\Program Files\nodejs\node.exe" "server path.js" --flag`;
    expect(parseStdioTarget(target)).toEqual({
      command: String.raw`C:\Program Files\nodejs\node.exe`,
      args: ["server path.js", "--flag"],
    });
    expect(
      parseStdioTarget(
        formatStdioTarget(String.raw`C:\Program Files\nodejs\node.exe`, [
          "server path.js",
          "--flag",
        ])
      )
    ).toEqual({
      command: String.raw`C:\Program Files\nodejs\node.exe`,
      args: ["server path.js", "--flag"],
    });
  });

  it("preserves intentionally empty quoted arguments", () => {
    expect(parseStdioTarget('node server.js ""')).toEqual({
      command: "node",
      args: ["server.js", ""],
    });
  });

  it("rejects unterminated quoted commands", () => {
    expect(() => parseStdioTarget('"node server.js')).toThrow(
      "Unterminated quote"
    );
  });

  it("rejects an empty command", () => {
    expect(() => parseStdioTarget("   ")).toThrow("cannot be empty");
  });

  it("rejects an empty quoted executable", () => {
    expect(() => parseStdioTarget('""')).toThrow("cannot be empty");
    expect(() => parseStdioTarget('"" --flag')).toThrow("cannot be empty");
  });
});

describe("formatStdioTarget", () => {
  it("shell-quotes tokens so spaces remain unambiguous", () => {
    expect(
      formatStdioTarget("/opt/MCP Servers/server", ["--config=dev env.json"])
    ).toBe('"/opt/MCP Servers/server" "--config=dev env.json"');
  });
});
