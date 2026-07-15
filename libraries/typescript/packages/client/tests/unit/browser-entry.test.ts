import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const browserEntries = ["dist/index-browser.js", "dist/react/index.js"];
const forbidden = [
  "node:",
  "cross-spawn",
  "@modelcontextprotocol/client/stdio",
];

describe("browser entry bundles", () => {
  for (const entry of browserEntries) {
    it(`${entry} must not include Node-only dependencies`, async () => {
      const source = await readFile(new URL(`../../${entry}`, import.meta.url), "utf8");
      const match = forbidden.find((dependency) => source.includes(dependency));

      expect(match, `${entry} must not include ${match}`).toBeUndefined();
    });
  }
});
