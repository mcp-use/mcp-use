import { useCallback, useEffect, useState, type RefObject } from "react";

export type WidgetDisplayMode = "inline" | "pip" | "fullscreen";

const SHELL_BASE =
  "w-full h-full min-h-0 bg-background flex flex-col [&:fullscreen]:h-full [&:fullscreen]:w-full [&:fullscreen]:bg-background";

/** Shell when the browser owns the viewport via Fullscreen API. */
export const WIDGET_FULLSCREEN_NATIVE_CLASSES = SHELL_BASE;

/** Shell when Fullscreen API is unavailable (CSS fallback). */
export const WIDGET_FULLSCREEN_OVERLAY_CLASSES = `fixed inset-0 z-[100] ${SHELL_BASE}`;

export const WIDGET_FULLSCREEN_DOCUMENT_ATTR = "data-mcp-widget-fullscreen";

function fullscreenShellClass(cssFallback: boolean): string {
  return cssFallback
    ? WIDGET_FULLSCREEN_OVERLAY_CLASSES
    : WIDGET_FULLSCREEN_NATIVE_CLASSES;
}

export function useWidgetFullscreenDocumentChrome(active: boolean): void {
  useEffect(() => {
    if (typeof document === "undefined" || !active) return;
    document.documentElement.setAttribute(WIDGET_FULLSCREEN_DOCUMENT_ATTR, "");
    return () => {
      document.documentElement.removeAttribute(WIDGET_FULLSCREEN_DOCUMENT_ATTR);
    };
  }, [active]);
}

/** Native Fullscreen API first; CSS overlay only when `requestFullscreen` fails. */
export function useWidgetFullscreenControls({
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

  useWidgetFullscreenDocumentChrome(isFullscreen);

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

  return { handleDisplayModeChange, fullscreenShellClassName, isFullscreen };
}
