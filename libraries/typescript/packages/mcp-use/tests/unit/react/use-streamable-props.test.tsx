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
    updateModelContext: vi.fn().mockResolvedValue(undefined),
    sendSizeChanged: vi.fn(),
  };

  return { bridge };
});

vi.mock("../../../src/react/mcp-apps-bridge.js", () => ({
  getMcpAppsBridge: () => bridge,
}));

const { useStreamableProps } = await import("../../../src/react/useWidget.js");

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const iframeParent = { postMessage: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "parent", {
    configurable: true,
    value: iframeParent,
  });

  bridge.connect.mockResolvedValue(undefined);
  bridge.isConnected.mockReturnValue(true);
  bridge.getToolInput.mockReturnValue({ baseParam: "base" });
  bridge.getToolOutput.mockReturnValue(null);
  bridge.getToolResponseMetadata.mockReturnValue(null);
  bridge.getPartialToolInput.mockReturnValue(null);
  bridge.getHostContext.mockReturnValue({
    theme: "light",
  });

  // Setup noop unsubscribers
  bridge.onToolInput.mockReturnValue(() => {});
  bridge.onToolInputPartial.mockReturnValue(() => {});
  bridge.onToolResult.mockReturnValue(() => {});
  bridge.onHostContextChange.mockReturnValue(() => {});
});

describe("useStreamableProps hook", () => {
  it("should return base props when not streaming", async () => {
    let hookResult: any = null;

    const TestComponent = () => {
      hookResult = useStreamableProps({ baseParam: "default" });
      return null;
    };

    let renderer: any;
    await act(async () => {
      renderer = create(<TestComponent />);
    });

    expect(hookResult).toBeDefined();
    expect(hookResult.props).toEqual({ baseParam: "base" });
    expect(hookResult.isStreaming).toBe(false);
    expect(hookResult.isPending).toBe(true);

    renderer.unmount();
  });

  it("should merge partialToolInput into props when streaming is active", async () => {
    let hookResult: any = null;
    let partialInputCallback: any = null;

    bridge.onToolInputPartial.mockImplementation((handler: any) => {
      partialInputCallback = handler;
      return () => {};
    });

    const TestComponent = () => {
      hookResult = useStreamableProps();
      return null;
    };

    let renderer: any;
    await act(async () => {
      renderer = create(<TestComponent />);
    });

    // Simulating partial tool input streaming
    await act(async () => {
      partialInputCallback({ baseParam: "base", partialParam: "streaming" });
    });

    expect(hookResult.isStreaming).toBe(true);
    expect(hookResult.props).toEqual({
      baseParam: "base",
      partialParam: "streaming",
    });

    renderer.unmount();
  });
});
