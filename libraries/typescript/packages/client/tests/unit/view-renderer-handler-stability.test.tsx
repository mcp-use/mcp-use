// @vitest-environment jsdom

import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { ViewRenderer } from "../../src/react/view/ViewRenderer.js";
import type {
  ViewLifecycleEvent,
  ViewRendererSource,
} from "../../src/react/view/types.js";

describe("ViewRenderer handler stability", () => {
  it("routes iframe console records without forwarding them to the app bridge", async () => {
    const source: ViewRendererSource = {
      kind: "preloaded",
      html: "<html><body>widget</body></html>",
    };
    const sandboxWindow = {} as Window;
    const onLog = vi.fn();
    const downstreamListener = vi.fn();
    let renderer!: ReactTestRenderer;

    window.addEventListener("message", downstreamListener);
    try {
      await act(async () => {
        renderer = create(
          <ViewRenderer
            viewId="console-message-test"
            source={source}
            sandboxUrl={new URL("https://sandbox.example/widget")}
            onLog={onLog}
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

      const event = new MessageEvent("message", {
        data: {
          type: "iframe-console-log",
          level: "error",
          args: ["widget failure"],
        },
        origin: "https://sandbox.example",
      });
      Object.defineProperty(event, "source", { value: sandboxWindow });

      await act(async () => {
        window.dispatchEvent(event);
      });

      expect(onLog).toHaveBeenCalledWith({
        level: "error",
        data: ["widget failure"],
      });
      expect(downstreamListener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("message", downstreamListener);
      await act(async () => {
        renderer?.unmount();
      });
    }
  });

  it("does not restart the bridge when a configured handler changes identity", async () => {
    const source: ViewRendererSource = {
      kind: "preloaded",
      html: "<html><body>widget</body></html>",
    };
    const sandboxUrl = new URL("https://sandbox.example/widget");
    const lifecycleEvents: ViewLifecycleEvent[] = [];
    const onLifecycleChange = (event: ViewLifecycleEvent) => {
      lifecycleEvents.push(event);
    };
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        <ViewRenderer
          viewId="stable-handler-test"
          source={source}
          sandboxUrl={sandboxUrl}
          onMessage={vi.fn()}
          onLifecycleChange={onLifecycleChange}
        />,
        {
          createNodeMock: (element) =>
            element.type === "iframe"
              ? {
                  contentWindow: {},
                  setAttribute: vi.fn(),
                  src: "",
                }
              : {},
        }
      );
    });

    expect(
      lifecycleEvents.filter((event) => event.status === "connecting")
    ).toHaveLength(1);

    await act(async () => {
      renderer.update(
        <ViewRenderer
          viewId="stable-handler-test"
          source={source}
          sandboxUrl={sandboxUrl}
          onMessage={vi.fn()}
          onLifecycleChange={onLifecycleChange}
        />
      );
    });

    expect(
      lifecycleEvents.filter((event) => event.status === "connecting")
    ).toHaveLength(1);

    await act(async () => {
      renderer.unmount();
    });
  });
});
