import {
  CLIENT_CAPABILITIES_META_KEY,
  type ClientCapabilities,
} from "@modelcontextprotocol/server";

import { UI_EXTENSION_ID, UI_MIME_TYPE } from "./constants.js";

/** Per-request client capabilities stashed before the SDK handler runs. */
const clientCapabilitiesByRequest = new WeakMap<Request, ClientCapabilities>();

/**
 * Stash parsed client capabilities on the request for the per-request server
 * factory.
 *
 * @internal
 */
export function stashClientCapabilities(
  request: Request,
  capabilities: ClientCapabilities
): void {
  clientCapabilitiesByRequest.set(request, capabilities);
}

/**
 * Read stashed client capabilities for an HTTP request.
 *
 * @internal
 */
export function getStashedClientCapabilities(
  request: Request | undefined
): ClientCapabilities | undefined {
  if (request === undefined) {
    return undefined;
  }
  return clientCapabilitiesByRequest.get(request);
}

/**
 * Extract `clientCapabilities` from a parsed JSON-RPC body, when present.
 *
 * @internal
 */
export function extractClientCapabilitiesFromBody(
  body: unknown
): ClientCapabilities | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const params = (body as Record<string, unknown>)["params"];
  if (typeof params !== "object" || params === null) {
    return undefined;
  }
  const meta = (params as Record<string, unknown>)["_meta"];
  if (typeof meta !== "object" || meta === null) {
    return undefined;
  }
  const capabilities = (meta as Record<string, unknown>)[
    CLIENT_CAPABILITIES_META_KEY
  ];
  if (typeof capabilities !== "object" || capabilities === null) {
    return undefined;
  }
  return capabilities as ClientCapabilities;
}

/**
 * Whether the client advertises MCP Apps / UI support for this request.
 *
 * True when `capabilities.extensions["io.modelcontextprotocol/ui"]` exists
 * and its `mimeTypes` array includes `text/html;profile=mcp-app`.
 */
export function supportsViews(
  capabilities: ClientCapabilities | undefined
): boolean {
  const extensions = capabilities?.extensions;
  if (extensions === undefined) {
    return false;
  }
  const uiExtension = extensions[UI_EXTENSION_ID];
  if (typeof uiExtension !== "object" || uiExtension === null) {
    return false;
  }
  const mimeTypes = (uiExtension as Record<string, unknown>)["mimeTypes"];
  if (!Array.isArray(mimeTypes)) {
    return false;
  }
  return mimeTypes.includes(UI_MIME_TYPE);
}
