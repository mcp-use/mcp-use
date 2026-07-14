/**
 * Client-side MCP Apps widget HTML resolution.
 *
 * Replaces the former `/widget/store` + `/widget-content/:toolId` HTTP round-trip:
 * the renderer already has the resources/read payload, so extract HTML + CSP here.
 */

const RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";

export type McpAppsWidgetCsp = {
  connectDomains?: string[];
  resourceDomains?: string[];
  frameDomains?: string[];
  baseUriDomains?: string[];
  scriptDirectives?: string[];
};

export type McpAppsWidgetPermissions = {
  camera?: object;
  microphone?: object;
  geolocation?: object;
  clipboardWrite?: object;
};

export type ResolvedMcpAppsWidget = {
  html: string;
  /** Declared CSP from resource `_meta.ui.csp` (always the declared value). */
  declaredCsp: McpAppsWidgetCsp | undefined;
  /**
   * CSP to enforce: undefined in permissive mode (proxy injects permissive policy),
   * otherwise the declared CSP.
   */
  csp: McpAppsWidgetCsp | undefined;
  permissions: McpAppsWidgetPermissions | undefined;
  prefersBorder: boolean;
  mimeType: string | undefined;
  mimeTypeValid: boolean;
  mimeTypeWarning: string | null;
};

type UiMeta = {
  csp?: McpAppsWidgetCsp;
  permissions?: McpAppsWidgetPermissions;
  prefersBorder?: boolean;
};

/**
 * Resolve guest HTML + CSP metadata from a resources/read result and optional
 * resources/list entry (content-item `_meta.ui` takes precedence over listing).
 */
export function resolveMcpAppsWidgetHtml(options: {
  resourceResult: unknown;
  listingResource?: { _meta?: { ui?: UiMeta } } | null;
  cspMode: "permissive" | "widget-declared";
  resourceUri?: string;
}): ResolvedMcpAppsWidget {
  const { resourceResult, listingResource, cspMode, resourceUri } = options;
  const contentsArray = Array.isArray(
    (resourceResult as { contents?: unknown })?.contents
  )
    ? ((resourceResult as { contents: unknown[] }).contents as Array<{
        mimeType?: string;
        text?: string;
        blob?: string;
        _meta?: { ui?: UiMeta };
      }>)
    : [];

  const firstContent = contentsArray[0];
  let htmlContent = "";
  let mimeType: string | undefined;

  if (firstContent) {
    mimeType = firstContent.mimeType;
    if (typeof firstContent.text === "string") {
      htmlContent = firstContent.text;
    } else if (typeof firstContent.blob === "string") {
      htmlContent = atob(firstContent.blob);
    }
  }

  if (!htmlContent) {
    throw new Error("No HTML content in resource");
  }

  const listingUiMeta = listingResource?._meta?.ui;
  const contentUiMeta = firstContent?._meta?.ui;
  const mergedUiMeta =
    listingUiMeta || contentUiMeta
      ? { ...listingUiMeta, ...contentUiMeta }
      : undefined;

  const declaredCsp = mergedUiMeta?.csp;
  const permissions = mergedUiMeta?.permissions;
  const prefersBorder = mergedUiMeta?.prefersBorder ?? false;

  const mimeTypeValid = mimeType === RESOURCE_MIME_TYPE;
  const mimeTypeWarning = !mimeTypeValid
    ? mimeType
      ? `Invalid MIME type "${mimeType}" - SEP-1865 requires "${RESOURCE_MIME_TYPE}"`
      : `Missing MIME type - SEP-1865 requires "${RESOURCE_MIME_TYPE}"`
    : null;

  if (mimeTypeWarning) {
    console.warn("[MCP Apps] MIME type validation:", mimeTypeWarning, {
      resourceUri,
    });
  }

  const isPermissive = cspMode === "permissive";

  return {
    html: htmlContent,
    declaredCsp,
    csp: isPermissive ? undefined : declaredCsp,
    permissions,
    prefersBorder,
    mimeType,
    mimeTypeValid,
    mimeTypeWarning,
  };
}
