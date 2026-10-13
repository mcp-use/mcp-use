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

  it("removes exact window message listener and cancels silently when unmounted before proxy ready", async () => {
    const sandboxWindow = {
      postMessage: vi.fn(),
    } as unknown as Window;
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

    // The readiness wait registers a message listener without capture phase (options !== true)
    const readinessAddCalls = addEventListenerSpy.mock.calls.filter(
      (call) => call[0] === "message" && call[2] !== true
    );
    expect(readinessAddCalls.length).toBe(1);
    const registeredWaitListener = readinessAddCalls[0]?.[1];
    expect(registeredWaitListener).toBeTypeOf("function");

    // Unmount before SANDBOX_PROXY_READY is received
    await act(async () => {
      renderer.unmount();
    });

    // Verify the exact readiness listener was removed on unmount
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "message",
      registeredWaitListener
    );

    // Unmount should cancel silently without triggering onError or error lifecycle event
    expect(onError).not.toHaveBeenCalled();
    expect(lifecycleEvents).not.toContainEqual(
      expect.objectContaining({ status: "error" })
    );
  });

  it("cleans up exact listener when SANDBOX_PROXY_READY is received", async () => {
    const sandboxWindow = {
      postMessage: vi.fn(),
    } as unknown as Window;
    const lifecycleEvents: ViewLifecycleEvent[] = [];
    const addEventListenerSpy = vi.spyOn(window, "addEventListener");
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

    const readinessAddCalls = addEventListenerSpy.mock.calls.filter(
      (call) => call[0] === "message" && call[2] !== true
    );
    const registeredWaitListener = readinessAddCalls[0]?.[1];
    expect(registeredWaitListener).toBeTypeOf("function");

    // Send SANDBOX_PROXY_READY from the iframe
    const readyEvent = new MessageEvent("message", {
      data: { method: "ui/notifications/sandbox-proxy-ready" },
      origin: "https://sandbox.example",
    });
    Object.defineProperty(readyEvent, "source", { value: sandboxWindow });

    await act(async () => {
      window.dispatchEvent(readyEvent);
    });

    // The ready listener should clean itself up upon resolution with the exact function
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "message",
      registeredWaitListener
    );

    await act(async () => {
      renderer.unmount();
    });
  });

  it("handles abort signal and cleans up exact window message listener in waitForSandboxProxyReady", async () => {
    const sandboxWindow = {
      postMessage: vi.fn(),
    } as unknown as Window;
    const iframe = { contentWindow: sandboxWindow } as HTMLIFrameElement;
    const addEventListenerSpy = vi.spyOn(window, "addEventListener");
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");
    const abortController = new AbortController();

    const promise = waitForSandboxProxyReady(iframe, {
      signal: abortController.signal,
    });
    const registeredListener = addEventListenerSpy.mock.calls.find(
      (call) => call[0] === "message"
    )?.[1];
    expect(registeredListener).toBeTypeOf("function");

    const expectation = expect(promise).rejects.toThrow(
      "View sandbox initialization was aborted"
    );

    abortController.abort();
    await expectation;

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "message",
      registeredListener
    );
  });

  it("allows slow initialization beyond 15s without timeout and continues when ready", async () => {
    vi.useFakeTimers();
    const sandboxWindow = {
      postMessage: vi.fn(),
    } as unknown as Window;
    const lifecycleEvents: ViewLifecycleEvent[] = [];
    const onError = vi.fn();
    const addEventListenerSpy = vi.spyOn(window, "addEventListener");
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        <ViewRenderer
          viewId="slow-init-test"
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

    expect(lifecycleEvents).toContainEqual({ status: "connecting" });

    const registeredWaitListener = addEventListenerSpy.mock.calls.find(
      (call) => call[0] === "message" && call[2] !== true
    )?.[1];
    expect(registeredWaitListener).toBeTypeOf("function");

    // Advance fake timers well beyond 15 seconds (e.g. 30 seconds)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    // Must NOT have timed out: no onError, no error status, listener remains attached
    expect(onError).not.toHaveBeenCalled();
    expect(lifecycleEvents).not.toContainEqual(
      expect.objectContaining({ status: "error" })
    );
    expect(removeEventListenerSpy).not.toHaveBeenCalledWith(
      "message",
      registeredWaitListener
    );

    // Deliver SANDBOX_PROXY_READY
    const readyEvent = new MessageEvent("message", {
      data: { method: "ui/notifications/sandbox-proxy-ready" },
      origin: "https://sandbox.example",
    });
    Object.defineProperty(readyEvent, "source", { value: sandboxWindow });

    await act(async () => {
      window.dispatchEvent(readyEvent);
    });

    // The listener should now be removed with the exact function
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "message",
      registeredWaitListener
    );

    // Initialization continues without error
    expect(onError).not.toHaveBeenCalled();
    expect(lifecycleEvents).not.toContainEqual(
      expect.objectContaining({ status: "error" })
    );

    await act(async () => {
      renderer.unmount();
    });
  });

  it("cleans up previous exact listener silently and accepts readiness on replaced bridge effect", async () => {
    const sandboxWindow = {
      postMessage: vi.fn(),
    } as unknown as Window;
    const lifecycleEvents: ViewLifecycleEvent[] = [];
    const onError = vi.fn();
    const addEventListenerSpy = vi.spyOn(window, "addEventListener");
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        <ViewRenderer
          viewId="initial-view-id"
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

    const firstWaitListener = addEventListenerSpy.mock.calls.find(
      (call) => call[0] === "message" && call[2] !== true
    )?.[1];
    expect(firstWaitListener).toBeTypeOf("function");

    // Change viewId dependency to trigger effect teardown and re-run
    await act(async () => {
      renderer.update(
        <ViewRenderer
          viewId="replaced-view-id"
          source={source}
          sandboxUrl={sandboxUrl}
          onError={onError}
          onLifecycleChange={(event) => lifecycleEvents.push(event)}
        />
      );
    });

    // Previous wait's exact listener must be removed
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "message",
      firstWaitListener
    );

    // Cancellation of previous wait must be silent
    expect(onError).not.toHaveBeenCalled();
    expect(lifecycleEvents).not.toContainEqual(
      expect.objectContaining({ status: "error" })
    );

    // Find the replacement readiness listener
    const secondWaitListener = addEventListenerSpy.mock.calls
      .filter((call) => call[0] === "message" && call[2] !== true)
      .map((call) => call[1])
      .find((listener) => listener !== firstWaitListener);
    expect(secondWaitListener).toBeTypeOf("function");

    // Deliver SANDBOX_PROXY_READY to the replacement wait
    const readyEvent = new MessageEvent("message", {
      data: { method: "ui/notifications/sandbox-proxy-ready" },
      origin: "https://sandbox.example",
    });
    Object.defineProperty(readyEvent, "source", { value: sandboxWindow });

    await act(async () => {
      window.dispatchEvent(readyEvent);
    });

    // Replacement wait cleans up its exact listener upon receiving readiness
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "message",
      secondWaitListener
    );

    // Initialization continues cleanly
    expect(onError).not.toHaveBeenCalled();
    expect(lifecycleEvents).not.toContainEqual(
      expect.objectContaining({ status: "error" })
    );

    await act(async () => {
      renderer.unmount();
    });
  });

  it("aborts cleanly when unmounted during blob loading without attaching listener or resuming initialization", async () => {
    let resolveFetch!: (value: unknown) => void;
    const fetchDeferred = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => fetchDeferred as Promise<Response>);

    const blobUrl = new URL("blob:https://sandbox.example/test-blob-uuid");
    const onError = vi.fn();
    const lifecycleEvents: ViewLifecycleEvent[] = [];
    const addEventListenerSpy = vi.spyOn(window, "addEventListener");
    const iframeMock = {
      contentWindow: {} as Window,
      setAttribute: vi.fn(),
      src: "",
      srcdoc: "",
    };

    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        <ViewRenderer
          viewId="blob-unmount-test"
          source={source}
          sandboxUrl={blobUrl}
          onError={onError}
          onLifecycleChange={(event) => lifecycleEvents.push(event)}
        />,
        {
          createNodeMock: (element) =>
            element.type === "iframe" ? iframeMock : {},
        }
      );
    });

    // fetch was initiated for the blob
    expect(fetchSpy).toHaveBeenCalledWith(blobUrl.href);

    // Unmount while fetch is still pending
    await act(async () => {
      renderer.unmount();
    });

    // Now resolve the deferred fetch and response text
    await act(async () => {
      resolveFetch({
        text: async () => "<html><body>deferred content</body></html>",
      });
      await Promise.resolve();
    });

    // Verify no readiness listener was attached to window
    const readinessAddCalls = addEventListenerSpy.mock.calls.filter(
      (call) => call[0] === "message" && call[2] !== true
    );
    expect(readinessAddCalls.length).toBe(0);

    // Verify iframe.srcdoc was never assigned and initialization did not resume
    expect(iframeMock.srcdoc).toBe("");

    // Verify no error was triggered
    expect(onError).not.toHaveBeenCalled();
    expect(lifecycleEvents).not.toContainEqual(
      expect.objectContaining({ status: "error" })
    );
  });
});
