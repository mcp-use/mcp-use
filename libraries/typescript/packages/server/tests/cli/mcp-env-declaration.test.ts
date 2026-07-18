import { describe, expect, it } from "vitest";

import { renderMcpEnvDeclaration } from "../../src/cli/mcp-env-declaration.js";

describe("renderMcpEnvDeclaration", () => {
  it.each([
    ["/project/index.ts", "./index.js"],
    ["/project/src/index.tsx", "./src/index.js"],
    ["/project/src/index.mts", "./src/index.mjs"],
    ["/project/src/index.cts", "./src/index.cjs"],
    ["/project/server.mjs", "./server.mjs"],
  ])("maps %s to the runtime import %s", (entry, expected) => {
    expect(renderMcpEnvDeclaration("/project", entry)).toContain(
      `tools: typeof import(${JSON.stringify(expected)})`
    );
  });

  it("includes CSS module typing", () => {
    expect(renderMcpEnvDeclaration("/project", "/project/index.ts")).toContain(
      'declare module "*.css"'
    );
  });
});
