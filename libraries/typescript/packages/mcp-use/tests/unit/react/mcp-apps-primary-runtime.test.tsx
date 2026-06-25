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

const { useWidget } = await import("../../../src/react/useWidget.js");
const { useCallTool } = await import("../../../src/react/useCallTool.js");
const { McpUseProvider } = await import("../../../src/react/McpUseProvider.js");
const { ModelContext, _resetModelContextForTesting } =
  await import("../../../src/react/model-context.js");

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const originalParent = window.parent;
const iframeParent = { postMessage: vi.fn() };

function makeOpenAiMock() {
  return {
    toolInput: { source: "openai-input" },
    toolOutput: { source: "openai-output" },
    toolResponseMetadata: { source: "openai-meta" },
    widgetState: null,
    theme: "light",
    displayMode: "inline",
    maxHeight: 111,
    locale: "en-US",
    safeArea: { insets: { top: 0, right: 0, bottom: 0, left: 0 } },
    userAgent: {
      device: { type: "desktop" },
      capabilities: { hover: true, touch: false },
    },
    callTool: vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "openai" }],
      structuredContent: { source: "openai-call" },
    }),
    sendFollowUpMessage: vi.fn().mockResolvedValue(undefined),
    openExternal: vi.fn(),
    requestDisplayMode: vi.fn().mockResolvedValue({ mode: "fullscreen" }),
    setWidgetState: vi.fn().mockResolvedValue(undefined),
    notifyIntrinsicHeight: vi.fn().mockResolvedValue(undefined),
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
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
  window.openai = makeOpenAiMock() as any;

  bridge.connect.mockResolvedValue(undefined);
  bridge.isConnected.mockReturnValue(true);
  bridge.getToolInput.mockReturnValue({ source: "mcp-input" });
  bridge.getToolOutput.mockReturnValue({ source: "mcp-output" });
  bridge.getToolResponseMetadata.mockReturnValue({ source: "mcp-meta" });
  bridge.getHostContext.mockReturnValue({
    theme: "dark",
    displayMode: "fullscreen",
    locale: "fr-FR",
    timeZone: "Europe/Paris",
    platform: "mobile",
    containerDimensions: { maxHeight: 444, maxWidth: 333 },
    safeAreaInsets: { top: 1, right: 2, bottom: 3, left: 4 },
    deviceCapabilities: { hover: false, touch: true },
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
  bridge.getHostInfo.mockReturnValue({ name: "chatgpt", version: "1.0.0" });
  bridge.getHostCapabilities.mockReturnValue({ openLinks: true });
  bridge.onToolInput.mockReturnValue(() => undefined);
  bridge.onToolInputPartial.mockReturnValue(() => undefined);
  bridge.onToolResult.mockReturnValue(() => undefined);
  bridge.onHostContextChange.mockReturnValue(() => undefined);
  bridge.callTool.mockResolvedValue({
    content: [{ type: "text", text: "mcp" }],
    structuredContent: { source: "mcp-call" },
  });
  bridge.sendMessage.mockResolvedValue(undefined);
  bridge.openLink.mockResolvedValue(undefined);
  bridge.requestDisplayMode.mockResolvedValue({ mode: "fullscreen" });
  bridge.updateModelContext.mockResolvedValue(undefined);
});

afterEach(() => {
  _resetModelContextForTesting();
  Object.defineProperty(window, "parent", {
    configurable: true,
    value: originalParent,
  });
  delete (window as any).openai;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.classList.remove("light", "dark");
});

describe("MCP Apps primary widget runtime", () => {
  it("uses MCP Apps data and actions when ChatGPT also exposes window.openai", async () => {
    let latest: ReturnType<typeof useWidget> | undefined;

    function TestComponent() {
      latest = useWidget();
      return null;
    }

    await act(async () => {
      create(<TestComponent />);
      await flushMicrotasks();
    });

    expect(bridge.connect).toHaveBeenCalledOnce();
    expect(latest?.props).toEqual({ source: "mcp-output" });
    expect(latest?.toolInput).toEqual({ source: "mcp-input" });
    expect(latest?.metadata).toEqual({ source: "mcp-meta" });
    expect(latest?.theme).toBe("dark");
    expect(latest?.displayMode).toBe("fullscreen");
    expect(latest?.locale).toBe("fr-FR");
    expect(latest?.timeZone).toBe("Europe/Paris");
    expect(latest?.maxHeight).toBe(444);
    expect(latest?.maxWidth).toBe(333);
    expect(latest?.hostInfo).toEqual({ name: "chatgpt", version: "1.0.0" });
    expect(latest?.hostCapabilities).toEqual({ openLinks: true });

    await act(async () => {
      await latest!.callTool("lookup", { id: 1 });
      await latest!.setState({ selected: "mcp" });
    });

    expect(bridge.callTool).toHaveBeenCalledWith("lookup", { id: 1 });
    expect(window.openai?.callTool).not.toHaveBeenCalled();
    expect(bridge.updateModelContext).toHaveBeenCalledWith({
      structuredContent: { selected: "mcp" },
      content: [{ type: "text", text: '{"selected":"mcp"}' }],
    });
    expect(window.openai?.setWidgetState).not.toHaveBeenCalled();
  });

  it("falls back to window.openai when the MCP Apps bridge never connects", async () => {
    // Simulate an Apps SDK-only host: window.openai is present but the parent
    // does not speak MCP Apps, so the bridge connect never resolves.
    bridge.connect.mockReturnValue(new Promise<void>(() => {}));
    bridge.isConnected.mockReturnValue(false);

    let latest: ReturnType<typeof useWidget> | undefined;

    function TestComponent() {
      latest = useWidget();
      return null;
    }

    await act(async () => {
      create(<TestComponent />);
      await flushMicrotasks();
    });

    // Data comes from window.openai, not the (never-connected) bridge.
    expect(latest?.isPending).toBe(false);
    expect(latest?.props).toEqual({ source: "openai-output" });
    expect(latest?.toolInput).toEqual({ source: "openai-input" });
    expect(latest?.metadata).toEqual({ source: "openai-meta" });
    expect(latest?.theme).toBe("light");
    expect(latest?.maxHeight).toBe(111);
    expect(latest?.isAvailable).toBe(true);

    // Actions route to window.openai while the bridge is unavailable.
    await act(async () => {
      await latest!.callTool("lookup", { id: 9 });
    });
    expect(window.openai?.callTool).toHaveBeenCalledWith("lookup", { id: 9 });
    expect(bridge.callTool).not.toHaveBeenCalled();
  });

  it("preserves ModelContext annotations when widget state is overwritten", async () => {
    let latest: ReturnType<typeof useWidget> | undefined;

    function TestComponent() {
      latest = useWidget();
      return <ModelContext content="Viewing product A" />;
    }

    await act(async () => {
      create(<TestComponent />);
      await flushMicrotasks();
    });

    expect(bridge.updateModelContext).toHaveBeenCalledWith({
      structuredContent: {
        __model_context: "- Viewing product A",
      },
      content: [{ type: "text", text: "- Viewing product A" }],
    });

    bridge.updateModelContext.mockClear();

    await act(async () => {
      await latest!.setState({ selectedTab: "reviews" });
    });

    expect(bridge.updateModelContext).toHaveBeenCalledWith({
      structuredContent: {
        selectedTab: "reviews",
        __model_context: "- Viewing product A",
      },
      content: [
        {
          type: "text",
          text: '- Viewing product A\n\nState: {"selectedTab":"reviews"}',
        },
      ],
    });
  });

  it("routes useCallTool through the MCP Apps bridge before window.openai", async () => {
    let latest: ReturnType<typeof useCallTool> | undefined;

    function TestComponent() {
      latest = useCallTool("lookup");
      return null;
    }

    await act(async () => {
      create(<TestComponent />);
    });

    await act(async () => {
      await latest!.callToolAsync({ id: 2 });
    });

    expect(bridge.callTool).toHaveBeenCalledWith("lookup", { id: 2 });
    expect(window.openai?.callTool).not.toHaveBeenCalled();
  });

  it("sends autosize notifications over MCP Apps instead of window.openai", async () => {
    vi.useFakeTimers();

    let resizeCallback: ResizeObserverCallback | undefined;

    class MockResizeObserver {
      observe = vi.fn();
      disconnect = vi.fn();

      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }
    }

    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    const containerNode = { scrollHeight: 260 };

    await act(async () => {
      create(
        <McpUseProvider autoSize>
          <div>content</div>
        </McpUseProvider>,
        {
          createNodeMock: (element) =>
            element.type === "div" ? containerNode : null,
        }
      );
      await flushMicrotasks();
    });

    await act(async () => {
      resizeCallback?.(
        [
          {
            contentRect: { height: 240 },
            target: { scrollHeight: 260 },
          },
        ] as ResizeObserverEntry[],
        {} as ResizeObserver
      );
      vi.advanceTimersByTime(150);
    });

    expect(bridge.sendSizeChanged).toHaveBeenCalledWith({ height: 260 });
    expect(window.openai?.notifyIntrinsicHeight).not.toHaveBeenCalled();
  });
});
