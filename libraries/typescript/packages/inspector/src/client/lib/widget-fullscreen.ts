import { useEffect } from "react";

/** Viewport-covering shell when Fullscreen API is unavailable (CSS fallback). */
export const WIDGET_FULLSCREEN_OVERLAY_CLASSES =
  "fixed inset-0 z-[100] w-full h-full bg-background flex flex-col";

/** Minimal shell when the browser owns the viewport via Fullscreen API. */
export const WIDGET_FULLSCREEN_NATIVE_CLASSES =
  "w-full h-full bg-background flex flex-col";

/**
 * Set on `document.documentElement` while a widget is in fullscreen so host
 * apps (e.g. cloud dashboard) can hide sidebars / chat chrome.
 */
export const WIDGET_FULLSCREEN_DOCUMENT_ATTR = "data-mcp-widget-fullscreen";

/** True when display mode is fullscreen but the container is not the native fullscreen element. */
export function isCssFullscreenFallback(
  isFullscreenMode: boolean,
  container: HTMLElement | null
): boolean {
  if (!isFullscreenMode) return false;
  if (typeof document === "undefined") return true;
  return document.fullscreenElement !== container;
}

export function widgetFullscreenShellClassName(
  isFullscreenMode: boolean,
  container: HTMLElement | null
): string | undefined {
  if (!isFullscreenMode) return undefined;
  return isCssFullscreenFallback(isFullscreenMode, container)
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
