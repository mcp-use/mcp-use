import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import * as browserClient from "../../dist/index-browser.js";

const browserEntries = ["dist/index-browser.js", "dist/react/index.js"];
const forbidden = [
  "node:",
  "cross-spawn",
  "@modelcontextprotocol/client/stdio",
];

describe("browser entry bundles", () => {
  it("exports the platform-neutral elicitation helpers", () => {
    for (const helper of [
      "accept",
      "acceptWithDefaults",
      "applyDefaults",
      "cancel",
      "decline",
      "getDefaults",
      "validate",
    ] as const) {
      expect(browserClient[helper], helper).toBeTypeOf("function");
    }
  });

  it("can accept form defaults through the browser entry", () => {
    expect(
      browserClient.acceptWithDefaults({
        mode: "form",
        message: "Choose a display name",
        requestedSchema: {
          type: "object",
          properties: {
            name: { type: "string", default: "Guest" },
          },
        },
      })
    ).toEqual({ action: "accept", content: { name: "Guest" } });
  });

  for (const entry of browserEntries) {
    it(`${entry} must not include Node-only dependencies`, async () => {
      const source = await readFile(
        new URL(`../../${entry}`, import.meta.url),
        "utf8"
      );
      const match = forbidden.find((dependency) => source.includes(dependency));

      expect(match, `${entry} must not include ${match}`).toBeUndefined();
    });
  }
});
