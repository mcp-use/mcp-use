import { describe, expect, it } from "vitest";
import {
  assertAppCanCallTool,
  buildDefaultHostCapabilities,
  dispatchUiMessage,
  isToolVisibleToModel,
  resolveRequestedDisplayMode,
} from "../../../src/react/view/view-host-policy.js";

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

  it("advertises the exact configured message and context modalities", () => {
    expect(
      buildDefaultHostCapabilities({
        hasConnection: false,
        hasMessageHandler: true,
        hasModelContextHandler: true,
        hasLogHandler: false,
        messageCapabilities: { text: {}, image: {} },
        modelContextCapabilities: { text: {}, structuredContent: {} },
      })
    ).toEqual({
      openLinks: {},
      message: { text: {}, image: {} },
      updateModelContext: { text: {}, structuredContent: {} },
    });
  });
});

describe("isToolVisibleToModel", () => {
  it.each([
    ["missing metadata", {}, true],
    ["app only", { _meta: { ui: { visibility: ["app"] } } }, false],
    ["model only", { _meta: { ui: { visibility: ["model"] } } }, true],
    ["shared", { _meta: { ui: { visibility: ["model", "app"] } } }, true],
  ])("%s", (_label, tool, expected) => {
    expect(isToolVisibleToModel(tool)).toBe(expected);
  });
});

describe("dispatchUiMessage", () => {
  it("waits for the host handler before resolving", async () => {
    let release: (() => void) | undefined;
    let completed = false;
    const pending = dispatchUiMessage(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      [{ type: "text", text: "hello" }]
    ).then(() => {
      completed = true;
    });

    await Promise.resolve();
    expect(completed).toBe(false);
    release?.();
    await pending;
    expect(completed).toBe(true);
  });

  it("propagates handler failures and rejects empty messages", async () => {
    await expect(
      dispatchUiMessage(async () => {
        throw new Error("delivery failed");
      }, [{ type: "text", text: "hello" }])
    ).rejects.toThrow("delivery failed");
    await expect(dispatchUiMessage(async () => {}, [])).rejects.toThrow(
      "requires at least one content block"
    );
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
