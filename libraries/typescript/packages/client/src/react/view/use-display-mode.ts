import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { ViewDisplayMode } from "./types.js";

const SHELL_BASE =
  "w-full h-full min-h-0 bg-background flex flex-col [&:fullscreen]:h-full [&:fullscreen]:w-full [&:fullscreen]:bg-background";

// High z-index for hosts without a trapping stacking context; chat history
// toggle also hides via data-mcp-widget-fullscreen on <html>.
const WIDGET_FULLSCREEN_OVERLAY_CLASSES = `fixed inset-0 z-[200] ${SHELL_BASE}`;
const WIDGET_PIP_SHELL_CLASSES = [
  "fixed top-4 left-1/2 -translate-x-1/2 z-[200]",
  "rounded-3xl w-full min-w-[300px] h-[400px]",
  "shadow-2xl border overflow-hidden",
  "bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80",
  "flex flex-col",
].join(" ");

export const WIDGET_FULLSCREEN_DOCUMENT_ATTR = "data-mcp-widget-fullscreen";
export const WIDGET_DISPLAY_MODE_ATTR = "data-mcp-widget-display-mode";

const activeWidgetDisplayModes = new Map<symbol, ViewDisplayMode>();

function syncDocumentDisplayModeAttributes(): void {
  if (typeof document === "undefined") return;

  let hasFullscreen = false;
  let hasPip = false;

  for (const mode of activeWidgetDisplayModes.values()) {
    if (mode === "fullscreen") {
      hasFullscreen = true;
      break;
    }
    if (mode === "pip") {
      hasPip = true;
    }
  }

  if (hasFullscreen) {
    document.documentElement.setAttribute(
      WIDGET_DISPLAY_MODE_ATTR,
      "fullscreen"
    );
    document.documentElement.setAttribute(WIDGET_FULLSCREEN_DOCUMENT_ATTR, "");
  } else if (hasPip) {
    document.documentElement.setAttribute(WIDGET_DISPLAY_MODE_ATTR, "pip");
    document.documentElement.removeAttribute(WIDGET_FULLSCREEN_DOCUMENT_ATTR);
  } else {
    document.documentElement.removeAttribute(WIDGET_DISPLAY_MODE_ATTR);
    document.documentElement.removeAttribute(WIDGET_FULLSCREEN_DOCUMENT_ATTR);
  }
}

function useWidgetDisplayModeDocumentChrome(
  displayMode: ViewDisplayMode
): void {
  const widgetIdRef = useRef<symbol | null>(null);
  if (widgetIdRef.current === null) {
    widgetIdRef.current = Symbol("mcp-widget-display-mode");
  }

  useEffect(() => {
    const id = widgetIdRef.current!;
    if (displayMode === "pip" || displayMode === "fullscreen") {
      activeWidgetDisplayModes.set(id, displayMode);
    } else {
      activeWidgetDisplayModes.delete(id);
    }
    syncDocumentDisplayModeAttributes();

    return () => {
      activeWidgetDisplayModes.delete(id);
      syncDocumentDisplayModeAttributes();
    };
  }, [displayMode]);
}

export function useViewDisplayModeControls({
  displayMode,
  setDisplayMode,
}: {
  containerRef: RefObject<HTMLElement | null>;
  displayMode: ViewDisplayMode;
  setDisplayMode: (mode: ViewDisplayMode) => void;
}) {
  const isFullscreen = displayMode === "fullscreen";
  const isPip = displayMode === "pip";

  useWidgetDisplayModeDocumentChrome(displayMode);

  const handleDisplayModeChange = useCallback(
    (mode: ViewDisplayMode) => setDisplayMode(mode),
    [setDisplayMode]
  );

  return {
    handleDisplayModeChange,
    fullscreenShellClassName: isFullscreen
      ? WIDGET_FULLSCREEN_OVERLAY_CLASSES
      : undefined,
    pipShellClassName: isPip ? WIDGET_PIP_SHELL_CLASSES : undefined,
    isFullscreen,
    isPip,
  };
}

export const VIEW_DIMENSIONS = {
  PIP_MAX_WIDTH: 700,
  DEFAULT_HEIGHT: 400,
  FULLSCREEN_HEADER_HEIGHT: 50,
} as const;
