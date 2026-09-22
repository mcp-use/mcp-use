// @vitest-environment jsdom

import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it } from "vitest";
import { useViewDisplayModeControls } from "../../src/react/view/use-display-mode.js";
import type { ViewDisplayMode } from "../../src/react/view/types.js";

const DISPLAY_MODE_ATTR = "data-mcp-widget-display-mode";
const FULLSCREEN_ATTR = "data-mcp-widget-fullscreen";
let renderer: ReactTestRenderer | undefined;

function DisplayModeWidget({ mode }: { mode: ViewDisplayMode }) {
  useViewDisplayModeControls({
    containerRef: { current: null },
    displayMode: mode,
    setDisplayMode: () => undefined,
  });
  return null;
}

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  document.documentElement.removeAttribute(DISPLAY_MODE_ATTR);
  document.documentElement.removeAttribute(FULLSCREEN_ATTR);
});

describe("document display mode chrome", () => {
  it("keeps fullscreen attributes when an inline sibling mounts", async () => {
    await act(async () => {
      renderer = create(
        <>
          <DisplayModeWidget mode="fullscreen" />
          <DisplayModeWidget mode="inline" />
        </>
      );
    });

    expect(document.documentElement.getAttribute(DISPLAY_MODE_ATTR)).toBe(
      "fullscreen"
    );
    expect(document.documentElement.hasAttribute(FULLSCREEN_ATTR)).toBe(true);
  });

  it("falls back to another active widget mode on update and unmount", async () => {
    await act(async () => {
      renderer = create(
        <>
          <DisplayModeWidget mode="fullscreen" />
          <DisplayModeWidget mode="pip" />
        </>
      );
    });

    expect(document.documentElement.getAttribute(DISPLAY_MODE_ATTR)).toBe(
      "fullscreen"
    );

    await act(async () => {
      renderer.update(
        <>
          <DisplayModeWidget mode="inline" />
          <DisplayModeWidget mode="pip" />
        </>
      );
    });

    expect(document.documentElement.getAttribute(DISPLAY_MODE_ATTR)).toBe(
      "pip"
    );
    expect(document.documentElement.hasAttribute(FULLSCREEN_ATTR)).toBe(false);

    await act(async () => renderer?.unmount());
    renderer = undefined;

    expect(document.documentElement.hasAttribute(DISPLAY_MODE_ATTR)).toBe(
      false
    );
    expect(document.documentElement.hasAttribute(FULLSCREEN_ATTR)).toBe(false);
  });
});
