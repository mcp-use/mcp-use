// @vitest-environment jsdom

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, create } from "react-test-renderer";

const { bridge } = vi.hoisted(() => {
  const bridge = {
    connect: vi.fn(),
    isConnected: vi.fn(),
    getToolInput: vi.fn(),
    getToolOutput: vi.fn(),
    getToolResponseMetadata: vi.fn(),
    getHostContext: vi.fn(),
    getPartialToolInput: vi.fn(),
    getHostInfo: vi.fn(),
    getHostCapabilities: vi.fn(),
    onToolInput: vi.fn(),
    onToolInputPartial: vi.fn(),
    onToolResult: vi.fn(),
    onHostContextChange: vi.fn(),
    callTool: vi.fn(),
    sendMessage: vi.fn(),
    openLink: vi.fn(),
    requestDisplayMode: vi.fn(),
    updateModelContext: vi.fn(),
    sendSizeChanged: vi.fn(),
  };

  return { bridge };
});

vi.mock("../../../src/react/mcp-apps-bridge.js", () => ({
  getMcpAppsBridge: () => bridge,
}));

const { McpUseProvider } = await import("../../../src/react/McpUseProvider.js");
const { _resetModelContextForTesting } =
  await import("../../../src/react/model-context.js");

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const originalParent = window.parent;
const iframeParent = { postMessage: vi.fn() };

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

function renderProvider() {
  return create(
    React.createElement(
      McpUseProvider,
      { autoSize: false },
      React.createElement("div", null, "content")
    )
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetModelContextForTesting();

  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: false,
      media: "",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })
  );

  Object.defineProperty(window, "parent", {
    configurable: true,
    value: iframeParent,
  });

  bridge.connect.mockResolvedValue(undefined);
  bridge.isConnected.mockReturnValue(true);
  bridge.getToolInput.mockReturnValue(null);
  bridge.getToolOutput.mockReturnValue(null);
  bridge.getToolResponseMetadata.mockReturnValue(null);
  bridge.getHostContext.mockReturnValue({
    theme: "dark",
    displayMode: "fullscreen",
    styles: {
      variables: {
        "--color-background-primary": "transparent",
        "--color-background-secondary": "rgb(12 13 14)",
        "--color-background-tertiary": undefined,
        "--color-text-primary": "rgb(250 250 250)",
        color: "red",
      },
    },
  });
  bridge.getPartialToolInput.mockReturnValue(null);
  bridge.getHostInfo.mockReturnValue(null);
  bridge.getHostCapabilities.mockReturnValue(null);
  bridge.onToolInput.mockReturnValue(() => undefined);
  bridge.onToolInputPartial.mockReturnValue(() => undefined);
  bridge.onToolResult.mockReturnValue(() => undefined);
  bridge.onHostContextChange.mockReturnValue(() => undefined);
  bridge.updateModelContext.mockResolvedValue(undefined);
});

afterEach(() => {
  _resetModelContextForTesting();
  Object.defineProperty(window, "parent", {
    configurable: true,
    value: originalParent,
  });
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.classList.remove("light", "dark");
});

describe("host styles", () => {
  it("applies host context CSS variables through McpUseProvider", async () => {
    await act(async () => {
      renderProvider();
      await flushMicrotasks();
    });

    expect(
      document.documentElement.style.getPropertyValue(
        "--color-background-secondary"
      )
    ).toBe("rgb(12 13 14)");
    expect(
      document.documentElement.style.getPropertyValue(
        "--color-background-primary"
      )
    ).toBe("transparent");
    expect(
      document.documentElement.style.getPropertyValue(
        "--color-background-tertiary"
      )
    ).toBe("");
    expect(document.documentElement.style.getPropertyValue("color")).toBe("");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("uses system dark preference when MCP Apps host context omits theme", async () => {
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: true,
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });
    bridge.getHostContext.mockReturnValue({
      displayMode: "inline",
      styles: {
        variables: {
          "--color-background-secondary": "light-dark(white, black)",
        },
      },
    });

    await act(async () => {
      renderProvider();
      await flushMicrotasks();
    });

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });
});
