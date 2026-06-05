/**
 * ChatGPT Apps SDK-specific widget configuration helpers.
 */

export interface WidgetOpenaiConfig {
  /** URL opened when the user taps "Open in app" in ChatGPT fullscreen mode. */
  openInAppUrl?: string;
}

/**
 * Read ChatGPT-specific config from widget metadata.
 */
export function getWidgetOpenaiConfig(
  metadata: Record<string, unknown> | undefined
): WidgetOpenaiConfig | undefined {
  if (!metadata?.openai || typeof metadata.openai !== "object") {
    return undefined;
  }

  const openai = metadata.openai as WidgetOpenaiConfig;
  if (
    typeof openai.openInAppUrl !== "string" ||
    openai.openInAppUrl.trim().length === 0
  ) {
    return undefined;
  }

  return { openInAppUrl: openai.openInAppUrl };
}

/**
 * Inline script that sets `window.__mcpWidgetOpenai` and calls
 * `window.openai.setOpenInAppUrl({ href })` when the Apps SDK is ready.
 */
export function buildOpenInAppUrlInjectionScript(openInAppUrl: string): string {
  const configJson = JSON.stringify({ openInAppUrl });
  return `<script>(function(){var c=${configJson};window.__mcpWidgetOpenai=c;var href=c.openInAppUrl;if(!href)return;function apply(){if(window.openai&&typeof window.openai.setOpenInAppUrl==="function"){window.openai.setOpenInAppUrl({href:href}).catch(function(err){console.error("[mcp-use] setOpenInAppUrl failed:",err);});return true;}return false;}if(!apply()){window.addEventListener("openai:set_globals",function(){apply();});}})();</script>`;
}

/**
 * Inject ChatGPT open-in-app configuration into widget HTML.
 */
export function injectWidgetOpenaiConfig(
  html: string,
  openInAppUrl: string | undefined
): string {
  if (!openInAppUrl || html.includes("window.__mcpWidgetOpenai")) {
    return html;
  }

  const script = buildOpenInAppUrlInjectionScript(openInAppUrl);
  return html.replace(/<head[^>]*>/i, (match) => `${match}\n    ${script}`);
}
