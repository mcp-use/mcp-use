import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("node entry", () => {
  it("does not re-export browser OAuth modules", async () => {
    const source = await readFile(
      new URL("../../src/index.ts", import.meta.url),
      "utf8"
    );

    expect(source).not.toMatch(/auth\/browser/);
    expect(source).not.toMatch(/auth\/callback/);
    expect(source).not.toMatch(/BrowserOAuthClientProvider/);
    expect(source).not.toMatch(/onMcpAuthorization/);
  });
});
