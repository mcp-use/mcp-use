import { useEffect } from "react";

/** Viewport-covering shell for CSS fullscreen (portaled to `document.body`). */
export const WIDGET_FULLSCREEN_OVERLAY_CLASSES =
  "fixed inset-0 z-[100] w-full h-full bg-background flex flex-col";

/**
 * Set on `document.documentElement` while a widget is in CSS fullscreen so host
 * apps (e.g. cloud dashboard) can hide sidebars / chat chrome.
 */
export const WIDGET_FULLSCREEN_DOCUMENT_ATTR = "data-mcp-widget-fullscreen";

export function useWidgetFullscreenDocumentChrome(active: boolean): void {
  useEffect(() => {
    if (typeof document === "undefined" || !active) return;
    document.documentElement.setAttribute(WIDGET_FULLSCREEN_DOCUMENT_ATTR, "");
    return () => {
      document.documentElement.removeAttribute(WIDGET_FULLSCREEN_DOCUMENT_ATTR);
    };
  }, [active]);
}
