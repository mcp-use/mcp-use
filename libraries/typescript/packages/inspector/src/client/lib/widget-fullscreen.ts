import { useCallback, useEffect, useState, type RefObject } from "react";

type WidgetDisplayMode = "inline" | "pip" | "fullscreen";

const SHELL_BASE =
  "w-full h-full min-h-0 bg-background flex flex-col [&:fullscreen]:h-full [&:fullscreen]:w-full [&:fullscreen]:bg-background";

/** Shell when the browser owns the viewport via Fullscreen API. */
const WIDGET_FULLSCREEN_NATIVE_CLASSES = SHELL_BASE;

/** Shell when Fullscreen API is unavailable (CSS fallback). */
const WIDGET_FULLSCREEN_OVERLAY_CLASSES = `fixed inset-0 z-[100] ${SHELL_BASE}`;

/** PiP floating card; portaled to document.body to escape host stacking contexts. */
const WIDGET_PIP_SHELL_CLASSES = [
  "fixed top-4 left-1/2 -translate-x-1/2 z-[100]",
  "rounded-3xl w-full min-w-[300px] h-[400px]",
  "shadow-2xl border overflow-hidden",
  "bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80",
  "flex flex-col",
].join(" ");

/** Legacy host hook; kept alongside the display-mode attr for embedded hosts. */
const WIDGET_FULLSCREEN_DOCUMENT_ATTR = "data-mcp-widget-fullscreen";

const WIDGET_DISPLAY_MODE_ATTR = "data-mcp-widget-display-mode";

function fullscreenShellClass(cssFallback: boolean): string {
  return cssFallback
    ? WIDGET_FULLSCREEN_OVERLAY_CLASSES
    : WIDGET_FULLSCREEN_NATIVE_CLASSES;
}

function useWidgetDisplayModeDocumentChrome(
  displayMode: WidgetDisplayMode
): void {
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (displayMode === "pip" || displayMode === "fullscreen") {
      document.documentElement.setAttribute(
        WIDGET_DISPLAY_MODE_ATTR,
        displayMode
      );
      if (displayMode === "fullscreen") {
        document.documentElement.setAttribute(
          WIDGET_FULLSCREEN_DOCUMENT_ATTR,
          ""
        );
      } else {
        document.documentElement.removeAttribute(
          WIDGET_FULLSCREEN_DOCUMENT_ATTR
        );
      }
      return () => {
        document.documentElement.removeAttribute(WIDGET_DISPLAY_MODE_ATTR);
        document.documentElement.removeAttribute(
          WIDGET_FULLSCREEN_DOCUMENT_ATTR
        );
      };
    }
    document.documentElement.removeAttribute(WIDGET_DISPLAY_MODE_ATTR);
    document.documentElement.removeAttribute(WIDGET_FULLSCREEN_DOCUMENT_ATTR);
  }, [displayMode]);
}

/** Native Fullscreen API first; CSS overlay only when `requestFullscreen` fails. */
export function useWidgetDisplayModeControls({
  containerRef,
  displayMode,
  setDisplayMode,
}: {
  /** Shell that includes exit chrome + widget; promoted via `requestFullscreen`. */
  containerRef: RefObject<HTMLElement | null>;
  displayMode: WidgetDisplayMode;
  setDisplayMode: (mode: WidgetDisplayMode) => void;
}) {
  const [cssFallback, setCssFallback] = useState(false);
  const isFullscreen = displayMode === "fullscreen";
  const isPip = displayMode === "pip";

  useWidgetDisplayModeDocumentChrome(displayMode);

  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement && displayMode === "fullscreen") {
        setCssFallback(false);
        setDisplayMode("inline");
      }
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, [displayMode, setDisplayMode]);

  const handleDisplayModeChange = useCallback(
    async (mode: WidgetDisplayMode) => {
      if (mode === "fullscreen") {
        try {
          await containerRef.current?.requestFullscreen();
          setCssFallback(false);
        } catch {
          setCssFallback(true);
        }
        setDisplayMode("fullscreen");
        return;
      }

      try {
        if (document.fullscreenElement) {
          await document.exitFullscreen();
        }
      } catch {
        // exitFullscreen can fail if already exited
      }
      setCssFallback(false);
      setDisplayMode(mode);
    },
    [containerRef, setDisplayMode]
  );

  const fullscreenShellClassName = isFullscreen
    ? fullscreenShellClass(cssFallback)
    : undefined;

  const pipShellClassName = isPip ? WIDGET_PIP_SHELL_CLASSES : undefined;

  return {
    handleDisplayModeChange,
    fullscreenShellClassName,
    pipShellClassName,
    isFullscreen,
    isPip,
  };
}
