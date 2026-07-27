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

  it("renders edge-to-edge fullscreen with a floating host close control", async () => {
    const onDisplayModeChange = vi.fn();
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        <ViewRenderer
          viewId="embedded-fullscreen-test"
          source={{
            kind: "preloaded",
            html: "<html><body>widget</body></html>",
          }}
          sandboxUrl={new URL("https://sandbox.example/widget")}
          displayMode="fullscreen"
          fullscreenHeader={false}
          onDisplayModeChange={onDisplayModeChange}
          renderFullscreenClose={(props) => (
            <button type="button" {...props}>
              Minimize
            </button>
          )}
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

    expect(renderer.root.findAllByType("header")).toHaveLength(0);
    const close = renderer.root.findByProps({
      "data-testid": "debugger-exit-fullscreen-button",
    });

    await act(async () => {
      close.props.onClick();
    });

    expect(onDisplayModeChange).toHaveBeenCalledWith("inline");

    await act(async () => {
      renderer.unmount();
    });
  });
});
