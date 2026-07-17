import { describe, expect, it } from "vitest";

import { renderToolsDeclaration } from "../../src/cli/tools-declaration.js";

describe("renderToolsDeclaration", () => {
  it.each([
    ["/project/index.ts", "./index.js"],
    ["/project/src/index.tsx", "./src/index.js"],
    ["/project/src/index.mts", "./src/index.mjs"],
    ["/project/src/index.cts", "./src/index.cjs"],
    ["/project/server.mjs", "./server.mjs"],
  ])("maps %s to the runtime import %s", (entry, expected) => {
    expect(renderToolsDeclaration("/project", entry)).toContain(
      `tools: typeof import(${JSON.stringify(expected)})`
    );
  });
});
