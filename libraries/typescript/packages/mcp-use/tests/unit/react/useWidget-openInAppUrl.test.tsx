// @vitest-environment jsdom

/**
 * Tests for ChatGPT "Open in app" URL support in useWidget:
 *
 * - The imperative `setOpenInAppUrl(href)` forwards `{ href }` to
 *   `window.openai.setOpenInAppUrl` when running inside ChatGPT.
 * - It is a graceful no-op when the host does not expose the method, and
 *   outside ChatGPT (no `window.openai`).
 * - The declarative `metadata.openai.openInAppUrl` — delivered to the iframe as
 *   `window.__mcpOpenInAppUrl` — is applied once on mount.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, create } from "react-test-renderer";
import { useWidget } from "../../../src/react/useWidget.js";

let latest: ReturnType<typeof useWidget> | null = null;

function Probe() {
  latest = useWidget();
  return null;
}

function renderWidget() {
  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(<Probe />);
  });
  // @ts-expect-error assigned inside act
  return renderer;
}

function setOpenAi(value: unknown) {
  (window as any).openai = value;
}

beforeEach(() => {
  latest = null;
  delete (window as any).openai;
  delete (window as any).__mcpOpenInAppUrl;
});

afterEach(() => {
  delete (window as any).openai;
  delete (window as any).__mcpOpenInAppUrl;
  vi.clearAllMocks();
});

describe("imperative setOpenInAppUrl", () => {
  it("forwards { href } to window.openai.setOpenInAppUrl", () => {
    const setOpenInAppUrl = vi.fn();
    setOpenAi({ setOpenInAppUrl });

    const renderer = renderWidget();
    act(() => {
      latest!.setOpenInAppUrl("https://app.example.com/item/42");
    });

    expect(setOpenInAppUrl).toHaveBeenCalledWith({
      href: "https://app.example.com/item/42",
    });
    act(() => renderer.unmount());
  });

  it("is a graceful no-op when the host lacks the method", () => {
    setOpenAi({}); // ChatGPT provider, but older host without the method
    const renderer = renderWidget();

    expect(() =>
      act(() => {
        latest!.setOpenInAppUrl("https://app.example.com/x");
      })
    ).not.toThrow();
    act(() => renderer.unmount());
  });

  it("is a no-op outside ChatGPT (no window.openai)", () => {
    vi.useFakeTimers();
    try {
      const renderer = renderWidget(); // provider falls back to mcp-ui
      expect(() =>
        act(() => {
          latest!.setOpenInAppUrl("https://app.example.com/x");
        })
      ).not.toThrow();
      act(() => renderer.unmount());
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("declarative metadata.openai.openInAppUrl", () => {
  it("applies window.__mcpOpenInAppUrl once on mount", () => {
    const setOpenInAppUrl = vi.fn();
    (window as any).__mcpOpenInAppUrl = "https://app.example.com/from-meta";
    setOpenAi({ setOpenInAppUrl });

    const renderer = renderWidget();

    expect(setOpenInAppUrl).toHaveBeenCalledTimes(1);
    expect(setOpenInAppUrl).toHaveBeenCalledWith({
      href: "https://app.example.com/from-meta",
    });
    act(() => renderer.unmount());
  });

  it("does not call setOpenInAppUrl on mount when nothing is configured", () => {
    const setOpenInAppUrl = vi.fn();
    setOpenAi({ setOpenInAppUrl });

    const renderer = renderWidget();

    expect(setOpenInAppUrl).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });

  it("does not throw when configured but the host lacks the method", () => {
    (window as any).__mcpOpenInAppUrl = "https://app.example.com/from-meta";
    setOpenAi({}); // no setOpenInAppUrl on the host

    expect(() => {
      const renderer = renderWidget();
      act(() => renderer.unmount());
    }).not.toThrow();
  });
});
