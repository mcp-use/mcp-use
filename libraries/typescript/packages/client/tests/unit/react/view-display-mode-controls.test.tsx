// @vitest-environment jsdom

import React, { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import {
  useViewDisplayModeControls,
  WIDGET_DISPLAY_MODE_ATTR,
  WIDGET_FULLSCREEN_DOCUMENT_ATTR,
} from "../../../src/react/view/use-display-mode.js";
import type { ViewDisplayMode } from "../../../src/react/view/types.js";

function WidgetHost({ displayMode }: { displayMode: ViewDisplayMode }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useViewDisplayModeControls({
    containerRef,
    displayMode,
    setDisplayMode: () => {},
  });
  return <div ref={containerRef} />;
}

describe("useViewDisplayModeControls document chrome coordinator", () => {
  let renderer: ReactTestRenderer | null = null;

  async function renderWidgets(
    widgets: Record<string, ViewDisplayMode>
  ): Promise<void> {
    const element = (
      <div>
        {Object.entries(widgets).map(([key, displayMode]) => (
          <WidgetHost key={key} displayMode={displayMode} />
        ))}
      </div>
    );

    await act(async () => {
      if (renderer === null) {
        renderer = create(element);
      } else {
        renderer.update(element);
      }
    });
  }

  function expectDocumentMode(expectedMode: "fullscreen" | "pip" | null): void {
    const modeAttr = document.documentElement.getAttribute(
      WIDGET_DISPLAY_MODE_ATTR
    );
    const hasFullscreenAttr = document.documentElement.hasAttribute(
      WIDGET_FULLSCREEN_DOCUMENT_ATTR
    );

    if (expectedMode === "fullscreen") {
      expect(modeAttr).toBe("fullscreen");
      expect(hasFullscreenAttr).toBe(true);
    } else if (expectedMode === "pip") {
      expect(modeAttr).toBe("pip");
      expect(hasFullscreenAttr).toBe(false);
    } else {
      expect(modeAttr).toBeNull();
      expect(hasFullscreenAttr).toBe(false);
    }
  }

  beforeEach(() => {
    document.documentElement.removeAttribute(WIDGET_DISPLAY_MODE_ATTR);
    document.documentElement.removeAttribute(WIDGET_FULLSCREEN_DOCUMENT_ATTR);
  });

  afterEach(async () => {
    if (renderer !== null) {
      await act(async () => {
        renderer?.unmount();
      });
      renderer = null;
    }
    document.documentElement.removeAttribute(WIDGET_DISPLAY_MODE_ATTR);
    document.documentElement.removeAttribute(WIDGET_FULLSCREEN_DOCUMENT_ATTR);
  });

  it("preserves fullscreen attributes when mounting or transitioning an inline sibling", async () => {
    // Single fullscreen widget establishes document mode
    await renderWidgets({ w1: "fullscreen" });
    expectDocumentMode("fullscreen");

    // Sibling mounts in PiP while widget 1 is fullscreen
    await renderWidgets({ w1: "fullscreen", w2: "pip" });
    expectDocumentMode("fullscreen");

    // Sibling transitions pip -> inline (re-running its effect) without stripping fullscreen attributes
    await renderWidgets({ w1: "fullscreen", w2: "inline" });
    expectDocumentMode("fullscreen");

    // Adding another inline sibling still retains fullscreen
    await renderWidgets({ w1: "fullscreen", w2: "inline", w3: "inline" });
    expectDocumentMode("fullscreen");

    // Returning the fullscreen widget to inline clears document attributes
    await renderWidgets({ w1: "inline", w2: "inline", w3: "inline" });
    expectDocumentMode(null);
  });

  it("preserves fullscreen when unmounting one of two fullscreen widgets and clears on last unmount", async () => {
    // Two fullscreen widgets both register
    await renderWidgets({ w1: "fullscreen", w2: "fullscreen" });
    expectDocumentMode("fullscreen");

    // Unmounting one fullscreen widget preserves fullscreen for the sibling
    await renderWidgets({ w2: "fullscreen" });
    expectDocumentMode("fullscreen");

    // Unmounting the last fullscreen widget clears both document attributes
    await renderWidgets({});
    expectDocumentMode(null);
  });

  it("prioritizes fullscreen over PiP, falls back to PiP, and clears on return to inline", async () => {
    // Fullscreen takes precedence over PiP
    await renderWidgets({ w1: "fullscreen", w2: "pip" });
    expectDocumentMode("fullscreen");

    // Fullscreen exits; falls back to remaining widget's PiP mode
    await renderWidgets({ w1: "inline", w2: "pip" });
    expectDocumentMode("pip");

    // Remaining widget exits PiP; clears document attributes
    await renderWidgets({ w1: "inline", w2: "inline" });
    expectDocumentMode(null);
  });
});
