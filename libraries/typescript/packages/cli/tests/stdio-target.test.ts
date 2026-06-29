import { describe, expect, it } from "vitest";
import { parseStdioTarget } from "../src/utils/stdio-target.js";

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

  it("preserves Windows backslashes inside quoted command paths", () => {
    expect(
      parseStdioTarget(
        String.raw`"C:\Program Files\nodejs\node.exe" "server path.js" --flag`
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
});
