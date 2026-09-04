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

function WidgetHost({
  displayMode,
  setDisplayMode = () => {},
}: {
  displayMode: ViewDisplayMode;
  setDisplayMode?: (mode: ViewDisplayMode) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useViewDisplayModeControls({
    containerRef,
    displayMode,
    setDisplayMode,
  });
  return <div ref={containerRef} />;
}

describe("useViewDisplayModeControls document chrome coordinator", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute(WIDGET_DISPLAY_MODE_ATTR);
    document.documentElement.removeAttribute(WIDGET_FULLSCREEN_DOCUMENT_ATTR);
  });

  afterEach(() => {
    document.documentElement.removeAttribute(WIDGET_DISPLAY_MODE_ATTR);
    document.documentElement.removeAttribute(WIDGET_FULLSCREEN_DOCUMENT_ATTR);
  });

  it("sets and clears document attributes for a single fullscreen widget", async () => {
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(<WidgetHost displayMode="fullscreen" />);
    });

    expect(
      document.documentElement.getAttribute(WIDGET_DISPLAY_MODE_ATTR)
    ).toBe("fullscreen");
    expect(
      document.documentElement.hasAttribute(WIDGET_FULLSCREEN_DOCUMENT_ATTR)
    ).toBe(true);

    // Transition back to inline
    await act(async () => {
      renderer.update(<WidgetHost displayMode="inline" />);
    });

    expect(
      document.documentElement.hasAttribute(WIDGET_DISPLAY_MODE_ATTR)
    ).toBe(false);
    expect(
      document.documentElement.hasAttribute(WIDGET_FULLSCREEN_DOCUMENT_ATTR)
    ).toBe(false);

    await act(async () => {
      renderer.unmount();
    });
  });

  it("sets and clears document attributes for a single pip widget", async () => {
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(<WidgetHost displayMode="pip" />);
    });

    expect(
      document.documentElement.getAttribute(WIDGET_DISPLAY_MODE_ATTR)
    ).toBe("pip");
    expect(
      document.documentElement.hasAttribute(WIDGET_FULLSCREEN_DOCUMENT_ATTR)
    ).toBe(false);

    await act(async () => {
      renderer.unmount();
    });

    expect(
      document.documentElement.hasAttribute(WIDGET_DISPLAY_MODE_ATTR)
    ).toBe(false);
  });

  it("does not strip fullscreen attributes when an inline sibling mounts or updates", async () => {
    let root!: ReactTestRenderer;

    function MultiWidgetTimeline({
      widget1Mode,
      widget2Mode,
    }: {
      widget1Mode: ViewDisplayMode;
      widget2Mode: ViewDisplayMode;
    }) {
      return (
        <div>
          <WidgetHost displayMode={widget1Mode} />
          <WidgetHost displayMode={widget2Mode} />
        </div>
      );
    }

    await act(async () => {
      root = create(
        <MultiWidgetTimeline widget1Mode="fullscreen" widget2Mode="inline" />
      );
    });

    // Widget 1 is fullscreen, Widget 2 is inline. Root document must reflect fullscreen!
    expect(
      document.documentElement.getAttribute(WIDGET_DISPLAY_MODE_ATTR)
    ).toBe("fullscreen");
    expect(
      document.documentElement.hasAttribute(WIDGET_FULLSCREEN_DOCUMENT_ATTR)
    ).toBe(true);

    // Re-rendering or updating Widget 2 in inline mode must not clobber Widget 1's fullscreen
    await act(async () => {
      root.update(
        <MultiWidgetTimeline widget1Mode="fullscreen" widget2Mode="inline" />
      );
    });

    expect(
      document.documentElement.getAttribute(WIDGET_DISPLAY_MODE_ATTR)
    ).toBe("fullscreen");
    expect(
      document.documentElement.hasAttribute(WIDGET_FULLSCREEN_DOCUMENT_ATTR)
    ).toBe(true);

    // When Widget 1 returns to inline, document attributes clear
    await act(async () => {
      root.update(
        <MultiWidgetTimeline widget1Mode="inline" widget2Mode="inline" />
      );
    });

    expect(
      document.documentElement.hasAttribute(WIDGET_DISPLAY_MODE_ATTR)
    ).toBe(false);
    expect(
      document.documentElement.hasAttribute(WIDGET_FULLSCREEN_DOCUMENT_ATTR)
    ).toBe(false);

    await act(async () => {
      root.unmount();
    });
  });

  it("prioritizes fullscreen over pip and falls back to pip when fullscreen exits", async () => {
    let root!: ReactTestRenderer;

    function MultiWidgetTimeline({
      widget1Mode,
      widget2Mode,
    }: {
      widget1Mode: ViewDisplayMode;
      widget2Mode: ViewDisplayMode;
    }) {
      return (
        <div>
          <WidgetHost displayMode={widget1Mode} />
          <WidgetHost displayMode={widget2Mode} />
        </div>
      );
    }

    await act(async () => {
      root = create(
        <MultiWidgetTimeline widget1Mode="fullscreen" widget2Mode="pip" />
      );
    });

    // Fullscreen takes precedence over pip
    expect(
      document.documentElement.getAttribute(WIDGET_DISPLAY_MODE_ATTR)
    ).toBe("fullscreen");
    expect(
      document.documentElement.hasAttribute(WIDGET_FULLSCREEN_DOCUMENT_ATTR)
    ).toBe(true);

    // When Widget 1 exits fullscreen, Widget 2's pip mode takes effect
    await act(async () => {
      root.update(
        <MultiWidgetTimeline widget1Mode="inline" widget2Mode="pip" />
      );
    });

    expect(
      document.documentElement.getAttribute(WIDGET_DISPLAY_MODE_ATTR)
    ).toBe("pip");
    expect(
      document.documentElement.hasAttribute(WIDGET_FULLSCREEN_DOCUMENT_ATTR)
    ).toBe(false);

    // When Widget 2 also exits pip, all document attributes clear
    await act(async () => {
      root.update(
        <MultiWidgetTimeline widget1Mode="inline" widget2Mode="inline" />
      );
    });

    expect(
      document.documentElement.hasAttribute(WIDGET_DISPLAY_MODE_ATTR)
    ).toBe(false);
    expect(
      document.documentElement.hasAttribute(WIDGET_FULLSCREEN_DOCUMENT_ATTR)
    ).toBe(false);

    await act(async () => {
      root.unmount();
    });
  });
});
