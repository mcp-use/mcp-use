import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { MCPClient, loadConfigFile } from "../../../src/core/node.js";

const config = {
  mcpServers: {
    example: { command: "node", args: ["server.js"] },
  },
};

function configFileWith(contents: string): string {
  const directory = mkdtempSync(join(tmpdir(), "mcp-use-load-config-"));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  const filepath = join(directory, "config.json");
  writeFileSync(filepath, contents, "utf-8");
  return filepath;
}

describe("loadConfigFile", () => {
  it("parses a BOM-prefixed config to the same object as a plain config", () => {
    const json = JSON.stringify(config);
    const plainPath = configFileWith(json);
    const bomPath = configFileWith(`\uFEFF${json}`);

    expect(loadConfigFile(bomPath)).toEqual(loadConfigFile(plainPath));
    expect(loadConfigFile(bomPath)).toEqual(config);
  });

  it("still throws on malformed JSON", () => {
    const malformedPath = configFileWith(`\uFEFF{ "mcpServers": `);

    expect(() => loadConfigFile(malformedPath)).toThrow(SyntaxError);
  });

  it("loads a BOM-prefixed config through MCPClient.fromConfigFile", () => {
    const bomPath = configFileWith(`\uFEFF${JSON.stringify(config)}`);

    const client = MCPClient.fromConfigFile(bomPath);

    expect(client.config).toEqual(config);
  });
});
