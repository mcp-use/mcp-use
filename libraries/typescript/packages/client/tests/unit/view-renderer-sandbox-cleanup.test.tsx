// @vitest-environment jsdom

import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ViewRenderer,
  waitForSandboxProxyReady,
} from "../../src/react/view/ViewRenderer.js";
import type {
  ViewLifecycleEvent,
  ViewRendererSource,
} from "../../src/react/view/types.js";

describe("ViewRenderer sandbox lifecycle cleanup", () => {
  const source: ViewRendererSource = {
    kind: "preloaded",
    html: "<html><body>widget</body></html>",
  };
  const sandboxUrl = new URL("https://sandbox.example/widget");

  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("removes window message listener and cancels silently when unmounted before proxy ready", async () => {
    const sandboxWindow = {} as Window;
    const onError = vi.fn();
    const lifecycleEvents: ViewLifecycleEvent[] = [];
    let renderer!: ReactTestRenderer;
    const addEventListenerSpy = vi.spyOn(window, "addEventListener");
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");

    await act(async () => {
      renderer = create(
        <ViewRenderer
          viewId="cleanup-test"
          source={source}
          sandboxUrl={sandboxUrl}
          onError={onError}
          onLifecycleChange={(event) => lifecycleEvents.push(event)}
        />,
        {
          createNodeMock: (element) =>
            element.type === "iframe"
              ? {
                  contentWindow: sandboxWindow,
                  setAttribute: vi.fn(),
                  src: "",
                }
              : {},
        }
      );
    });

    // Verify message listener was attached
    const messageAddCalls = addEventListenerSpy.mock.calls.filter(
      (call) => call[0] === "message"
    );
    expect(messageAddCalls.length).toBeGreaterThan(0);

    // Unmount before SANDBOX_PROXY_READY is received
    await act(async () => {
      renderer.unmount();
    });

    // Verify message listeners were removed on unmount
    const messageRemoveCalls = removeEventListenerSpy.mock.calls.filter(
      (call) => call[0] === "message"
    );
    expect(messageRemoveCalls.length).toBeGreaterThanOrEqual(
      messageAddCalls.length
    );

    // Unmount should cancel silently without triggering onError or error lifecycle event
    expect(onError).not.toHaveBeenCalled();
    expect(lifecycleEvents).not.toContainEqual(
      expect.objectContaining({ status: "error" })
    );
  });

  it("cleans up listener when SANDBOX_PROXY_READY is received", async () => {
    const sandboxWindow = {} as Window;
    const lifecycleEvents: ViewLifecycleEvent[] = [];
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        <ViewRenderer
          viewId="handshake-test"
          source={source}
          sandboxUrl={sandboxUrl}
          onLifecycleChange={(event) => lifecycleEvents.push(event)}
        />,
        {
          createNodeMock: (element) =>
            element.type === "iframe"
              ? {
                  contentWindow: sandboxWindow,
                  setAttribute: vi.fn(),
                  src: "",
                }
              : {},
        }
      );
    });

    // Send SANDBOX_PROXY_READY from the iframe
    const readyEvent = new MessageEvent("message", {
      data: { method: "ui/notifications/sandbox-proxy-ready" },
      origin: "https://sandbox.example",
    });
    Object.defineProperty(readyEvent, "source", { value: sandboxWindow });

    await act(async () => {
      window.dispatchEvent(readyEvent);
    });

    // The ready listener should clean itself up upon resolution
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "message",
      expect.any(Function)
    );

    await act(async () => {
      renderer.unmount();
    });
  });

  it("handles timeout and cleans up window message listener", async () => {
    vi.useFakeTimers();
    const sandboxWindow = {} as Window;
    const iframe = { contentWindow: sandboxWindow } as HTMLIFrameElement;
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");

    const promise = waitForSandboxProxyReady(iframe, { timeoutMs: 5000 });
    const expectation = expect(promise).rejects.toThrow(
      "Sandbox proxy did not become ready within 5000ms"
    );

    await vi.advanceTimersByTimeAsync(5001);
    await expectation;

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "message",
      expect.any(Function)
    );
  });

  it("handles abort signal and cleans up window message listener", async () => {
    const sandboxWindow = {} as Window;
    const iframe = { contentWindow: sandboxWindow } as HTMLIFrameElement;
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");
    const abortController = new AbortController();

    const promise = waitForSandboxProxyReady(iframe, {
      signal: abortController.signal,
    });
    const expectation = expect(promise).rejects.toThrow(
      "View sandbox initialization was aborted"
    );

    abortController.abort();
    await expectation;

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "message",
      expect.any(Function)
    );
  });
});
