import { MCPServer, registerViews } from "../src/index.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { normalizeViewConfig } from "../src/react/runtime/view-config.js";
import type { ViewConfig } from "../src/react/runtime/view-config.js";

describe("viewConfig display preferences", () => {
  it("resolves existing defaults without adding an initial preference", () => {
    expect(normalizeViewConfig()).toEqual({
      autoResize: true,
      displayModes: ["inline", "fullscreen", "pip"],
    });
    expect(
      normalizeViewConfig({ preferredDisplayMode: "fullscreen" })
        .preferredDisplayMode
    ).toBe("fullscreen");
  });
  it("retains the preference and supported order", () => {
    expect(
      normalizeViewConfig({
        displayModes: ["fullscreen", "inline"],
        preferredDisplayMode: "fullscreen",
      })
    ).toEqual({
      autoResize: true,
      displayModes: ["fullscreen", "inline"],
      preferredDisplayMode: "fullscreen",
    });
  });
  it("rejects a preference outside supported modes", () => {
    expect(() =>
      normalizeViewConfig({
        displayModes: ["inline"],
        preferredDisplayMode: "fullscreen",
      })
    ).toThrow("must belong to displayModes");
  });
  it("rejects unsupported initial ChatGPT modes", () => {
    expect(() =>
      normalizeViewConfig({
        preferredDisplayMode: "pip",
      } as unknown as ViewConfig)
    ).toThrow('must be "inline" or "fullscreen"');
  });
  it("rejects invalid manifest config before serving or building resources", () => {
    const server = new MCPServer({ name: "invalid-view", version: "1" });
    expect(() =>
      server[registerViews]({
        card: {
          kind: "inline",
          js: "",
          css: "",
          viewConfig: {
            displayModes: ["inline"],
            preferredDisplayMode: "fullscreen",
          },
        },
      })
    ).toThrow(
      /View "card" has an invalid viewConfig: .*must belong to displayModes/
    );
  });
  it("does not retain views from a failed manifest when priming is retried", () => {
    const server = new MCPServer({ name: "retry-view", version: "1" });
    server.__primeSkills(undefined);
    expect(() =>
      server[registerViews]({
        stale: { kind: "inline", js: "", css: "" },
        invalid: {
          kind: "inline",
          js: "",
          css: "",
          viewConfig: {
            displayModes: ["inline"],
            preferredDisplayMode: "fullscreen",
          },
        },
      })
    ).toThrow("must belong to displayModes");
    server[registerViews]({});
    server.tool(
      {
        name: "stale-binding",
        outputSchema: z.object({}),
        view: { name: "stale" },
      },
      async () => ({ structuredContent: {}, content: [] })
    );
    expect(() => server.__mount()).toThrow(/not in the primed views registry/);
  });
  it("continues to reject a null support list", () => {
    expect(() =>
      normalizeViewConfig({ displayModes: null } as unknown as ViewConfig)
    ).toThrow("must be a non-empty array");
  });
  it("continues to require inline", () => {
    expect(() =>
      normalizeViewConfig({
        displayModes: ["fullscreen"],
        preferredDisplayMode: "fullscreen",
      })
    ).toThrow('must include "inline"');
  });
});
