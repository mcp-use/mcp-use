import { SET_GLOBALS_EVENT_TYPE } from "./widget-types.js";

export interface McpWidgetOpenaiConfig {
  openInAppUrl?: string;
}

/**
 * Apply `widgetMetadata.openai.openInAppUrl` by calling
 * `window.openai.setOpenInAppUrl({ href })` when running in ChatGPT.
 */
export function applyOpenInAppUrlFromConfig(): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const href = window.__mcpWidgetOpenai?.openInAppUrl;
  if (!href) {
    return () => {};
  }

  const apply = () => {
    if (typeof window.openai?.setOpenInAppUrl === "function") {
      window.openai.setOpenInAppUrl({ href }).catch((error) => {
        console.error("[mcp-use] Failed to set open in app URL:", error);
      });
      return true;
    }
    return false;
  };

  if (apply()) {
    return () => {};
  }

  const onGlobals = () => {
    apply();
  };

  window.addEventListener(SET_GLOBALS_EVENT_TYPE, onGlobals);
  return () => window.removeEventListener(SET_GLOBALS_EVENT_TYPE, onGlobals);
}
