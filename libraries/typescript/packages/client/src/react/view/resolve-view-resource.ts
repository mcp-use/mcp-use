import { RESOURCE_MIME_TYPE } from "./ext-apps-bridge.js";
import type {
  McpUiResourceCsp,
  McpUiResourcePermissions,
} from "./ext-apps-bridge.js";
import type { ResolvedViewResource, ViewCspMode } from "./types.js";

/** MCP App UI metadata read from a resource listing or content block. */
type UiMeta = {
  csp?: McpUiResourceCsp;
  permissions?: McpUiResourcePermissions;
  prefersBorder?: boolean;
};

/**
 * Normalizes a resource response into HTML and effective MCP App policy.
 *
 * Content-level UI metadata overrides listing metadata. In permissive mode the
 * declared CSP is reported but not enforced.
 *
 * @param options - Resource response, listing metadata, CSP policy, and URI.
 * @returns The normalized view resource.
 * @throws When the first content block contains no text or base64 HTML.
 */
export function resolveViewResource(options: {
  resourceResult: unknown;
  listingResource?: { _meta?: { ui?: unknown } } | null;
  cspMode: ViewCspMode;
  resourceUri?: string;
}): ResolvedViewResource {
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

  const listingUiMeta = listingResource?._meta?.ui as UiMeta | undefined;
  const contentUiMeta = firstContent?._meta?.ui as UiMeta | undefined;
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
    console.warn("[ViewRenderer] MIME type validation:", mimeTypeWarning, {
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
