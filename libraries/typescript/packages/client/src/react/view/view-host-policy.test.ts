import { describe, expect, it } from "vitest";
import {
  assertAppCanCallTool,
  buildDefaultHostCapabilities,
  resolveRequestedDisplayMode,
} from "./view-host-policy.js";

describe("buildDefaultHostCapabilities", () => {
  it("advertises only capabilities backed by the current surface", () => {
    expect(
      buildDefaultHostCapabilities({
        hasConnection: false,
        hasMessageHandler: false,
        hasModelContextHandler: false,
        hasLogHandler: false,
      })
    ).toEqual({ openLinks: {} });

    expect(
      buildDefaultHostCapabilities({
        hasConnection: true,
        hasMessageHandler: true,
        hasModelContextHandler: true,
        hasLogHandler: true,
      })
    ).toEqual({
      openLinks: {},
      serverTools: {},
      serverResources: {},
      logging: {},
      updateModelContext: { text: {} },
      message: { text: {} },
    });
  });
});

describe("resolveRequestedDisplayMode", () => {
  it("allows a mode supported by both host and app", () => {
    expect(
      resolveRequestedDisplayMode({
        requested: "fullscreen",
        current: "inline",
        hostAvailable: ["inline", "pip", "fullscreen"],
        appAvailable: ["inline", "fullscreen"],
      })
    ).toBe("fullscreen");
  });

  it("returns the current mode when the app did not declare the request", () => {
    expect(
      resolveRequestedDisplayMode({
        requested: "pip",
        current: "inline",
        hostAvailable: ["inline", "pip", "fullscreen"],
        appAvailable: ["inline", "fullscreen"],
      })
    ).toBe("inline");
  });

  it("defaults missing mode declarations to inline only", () => {
    expect(
      resolveRequestedDisplayMode({
        requested: "fullscreen",
        current: "inline",
      })
    ).toBe("inline");
  });
});

describe("assertAppCanCallTool", () => {
  const tools = [
    { name: "default-visible" },
    { name: "app-only", _meta: { ui: { visibility: ["app"] } } },
    {
      name: "shared",
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    { name: "model-only", _meta: { ui: { visibility: ["model"] } } },
  ] as const;

  it.each(["default-visible", "app-only", "shared"])("allows %s", (name) => {
    expect(() => assertAppCanCallTool(tools, name)).not.toThrow();
  });

  it.each(["model-only", "missing"])("rejects %s", (name) => {
    expect(() => assertAppCanCallTool(tools, name)).toThrow(
      `Tool "${name}" is not available to this app`
    );
  });
});
