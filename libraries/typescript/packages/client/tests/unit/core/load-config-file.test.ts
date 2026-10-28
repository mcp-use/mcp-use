import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfigFile } from "../../../src/core/node.js";

describe("loadConfigFile", () => {
  it("reads a config file that starts with a UTF-8 BOM", () => {
    // Windows PowerShell 5.1 `Out-File -Encoding utf8` writes a BOM.
    const root = mkdtempSync(join(tmpdir(), "mcp-use-config-"));
    try {
      const file = join(root, "mcp-config.json");
      writeFileSync(file, '\uFEFF{"mcpServers": {"a": {"command": "node"}}}');

      expect(loadConfigFile(file)).toEqual({
        mcpServers: { a: { command: "node" } },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
