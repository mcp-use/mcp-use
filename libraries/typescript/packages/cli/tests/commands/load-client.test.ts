import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  importProjectClientModule,
  loadClientPackage,
} from "../../src/commands/load-client.js";

const SERVER_PACKAGE_ROOT = join(
  fileURLToPath(new URL("../..", import.meta.url))
);

describe("loadClientPackage", () => {
  it("loads @mcp-use/client when installed", async () => {
    const mod = await loadClientPackage();
    expect(mod.MCPClient).toBeTypeOf("function");
    expect(mod.createOAuthProvider).toBeTypeOf("function");
  });

  it("imports @mcp-use/client from a project root after auto-install", async () => {
    const mod = await importProjectClientModule(SERVER_PACKAGE_ROOT);
    expect(mod.MCPClient).toBeTypeOf("function");
    expect(mod.createOAuthProvider).toBeTypeOf("function");
  });
});
