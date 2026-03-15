/**
 * Protocol Helper Functions
 *
 * Shared utilities for dual-protocol metadata building and widget URI generation.
 * Reduces duplication in ui-resource-registration.ts
 */

import { McpAppsAdapter } from "./adapters/mcp-apps.js";
import { AppsSdkAdapter } from "./adapters/apps-sdk.js";
import type { UIResourceDefinition } from "../types/resource.js";

/**
 * Create singleton instances of protocol adapters
 */
export function createProtocolAdapters() {
  return {
    mcpApps: new McpAppsAdapter(),
    appsSdk: new AppsSdkAdapter(),
  };
}

/**
 * Build dual-protocol metadata for both MCP Apps and Apps SDK
 *
 * @param definition - UI resource definition
 * @param uri - Resource URI
 * @param existingMetadata - Optional existing metadata to merge with
 * @returns Combined metadata object with both protocols
 */
export function buildDualProtocolMetadata(
  definition: UIResourceDefinition,
  uri: string,
  existingMetadata?: Record<string, unknown>
): Record<string, unknown> {
  const adapters = createProtocolAdapters();

  // Build tool metadata for both protocols
  const mcpAppsToolMeta = adapters.mcpApps.buildToolMetadata(definition, uri);
  const appsSdkToolMeta = adapters.appsSdk.buildToolMetadata(definition, uri);

  // Apps SDK resource metadata (openai/widgetCSP, openai/description) goes on tool
  // metadata because ChatGPT reads these from the tool definition.
  const appsSdkResourceMeta =
    adapters.appsSdk.buildResourceMetadata(definition);

  // Per SEP-1865: CSP belongs on the resource _meta.ui, not on the tool.
  // Tool _meta.ui only has resourceUri and visibility.
  return {
    ...existingMetadata,
    ...mcpAppsToolMeta, // ui: { resourceUri }, "ui/resourceUri"
    ...appsSdkToolMeta, // "openai/outputTemplate"
    ...(appsSdkResourceMeta._meta || {}), // "openai/widgetCSP", "openai/description"
  };
}

/**
 * Transform snake_case CSP (openai/widgetCSP format) to camelCase (ui.csp format).
 * Ensures resource _meta.ui.csp matches tool _meta["openai/widgetCSP"] for dual-protocol.
 */
function snakeCaseCspToCamelCase(
  wcsp: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!wcsp || typeof wcsp !== "object") return undefined;
  const result: Record<string, unknown> = {};
  if (Array.isArray(wcsp.connect_domains))
    result.connectDomains = wcsp.connect_domains;
  if (Array.isArray(wcsp.resource_domains))
    result.resourceDomains = wcsp.resource_domains;
  if (Array.isArray(wcsp.frame_domains))
    result.frameDomains = wcsp.frame_domains;
  if (Array.isArray(wcsp.base_uri_domains))
    result.baseUriDomains = wcsp.base_uri_domains;
  if (Array.isArray(wcsp.script_directives))
    result.scriptDirectives = wcsp.script_directives;
  if (Array.isArray(wcsp.style_directives))
    result.styleDirectives = wcsp.style_directives;
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Build MCP Apps resource metadata with CSP, prefersBorder, domain etc.
 *
 * Per MCP Apps spec (SEP-1865), these fields belong on the resource _meta.ui,
 * not on the tool definition.
 *
 * For dual-protocol (mcpApps), ui.csp is derived from the same source as
 * openai/widgetCSP so both tool and resource have identical CSP.
 *
 * @param definition - UI resource definition
 * @returns Resource metadata with _meta.ui containing CSP etc.
 */
export function buildResourceUiMeta(
  definition: UIResourceDefinition
): Record<string, unknown> | undefined {
  const adapters = createProtocolAdapters();
  const mcpAppsResourceMeta =
    adapters.mcpApps.buildResourceMetadata(definition);
  let uiMeta =
    (mcpAppsResourceMeta._meta?.ui as Record<string, unknown>) || undefined;

  // Dual-protocol: derive ui.csp from openai/widgetCSP so both are in sync
  if (definition.type === "mcpApps") {
    const appsSdkResourceMeta =
      adapters.appsSdk.buildResourceMetadata(definition);
    const openaiWidgetCSP = (
      appsSdkResourceMeta._meta as Record<string, unknown>
    )?.["openai/widgetCSP"] as Record<string, unknown> | undefined;
    const csp = snakeCaseCspToCamelCase(openaiWidgetCSP);
    if (csp) {
      uiMeta = { ...(uiMeta || {}), csp };
    }
  }

  return uiMeta && Object.keys(uiMeta).length > 0 ? uiMeta : undefined;
}

/**
 * Generate unique widget URI with random ID suffix
 *
 * @param name - Widget name
 * @param buildId - Optional build ID
 * @param extension - File extension (default: ".html")
 * @returns Unique widget URI
 */
export function generateUniqueWidgetUri(
  name: string,
  buildId: string | undefined,
  extension: string = ".html"
): string {
  const randomId = Math.random().toString(36).substring(2, 15);
  const buildIdPart = buildId ? `-${buildId}` : "";
  return `ui://widget/${name}${buildIdPart}-${randomId}${extension}`;
}

/**
 * Generate tool output content with resource reference
 *
 * @param definition - UI resource definition
 * @param params - Tool parameters
 * @param displayName - Display name for the widget
 * @returns Tool output with content array
 */
export function generateToolOutput(
  definition: UIResourceDefinition,
  params: Record<string, unknown>,
  displayName: string
): {
  content: Array<{
    type: string;
    text?: string;
    resource?: { uri: string; mimeType?: string };
  }>;
  structuredContent?: unknown;
} {
  const result: {
    content: Array<{
      type: string;
      text?: string;
      resource?: { uri: string; mimeType?: string };
    }>;
    structuredContent?: unknown;
  } = {
    content: [{ type: "text", text: displayName }],
  };

  // Add structured content if available
  if ("structuredContent" in definition && definition.structuredContent) {
    if (typeof definition.structuredContent === "function") {
      result.structuredContent = definition.structuredContent(params);
    } else {
      result.structuredContent = definition.structuredContent;
    }
  }

  return result;
}

/**
 * Get resource URI and MIME type based on definition type
 *
 * @param definition - UI resource definition
 * @param buildId - Optional build ID
 * @returns Object with uri and mimeType
 */
export function getResourceUriAndMimeType(
  definition: UIResourceDefinition,
  buildId: string | undefined
): { uri: string; mimeType: string } {
  const buildIdPart = buildId ? `-${buildId}` : "";

  switch (definition.type) {
    case "externalUrl":
      return {
        uri: (definition as any).href || (definition as any).url,
        mimeType: "text/uri-list",
      };

    case "rawHtml":
      return {
        uri: `ui://widget/${definition.name}${buildIdPart}.html`,
        mimeType: "text/html",
      };

    case "remoteDom":
      return {
        uri: `ui://widget/${definition.name}${buildIdPart}.js`,
        mimeType: "application/vnd.mcp-ui.remote-dom+javascript",
      };

    case "mcpApps":
      return {
        uri: `ui://widget/${definition.name}${buildIdPart}.html`,
        mimeType: "text/html;profile=mcp-app",
      };

    default:
      throw new Error(`Unknown widget type: ${(definition as any).type}`);
  }
}

/**
 * Detect schema type from props or schema
 *
 * @param propsOrSchema - Props definition or schema object
 * @returns Detected schema type and the schema itself
 */
export function detectSchemaType(propsOrSchema: unknown): {
  type: "zod" | "json" | "widgetProps" | null;
  schema: unknown;
} {
  if (!propsOrSchema) {
    return { type: null, schema: null };
  }

  // Check if it's a Zod schema (has _def property)
  if (
    typeof propsOrSchema === "object" &&
    propsOrSchema !== null &&
    "_def" in propsOrSchema
  ) {
    return { type: "zod", schema: propsOrSchema };
  }

  // Check if it's a JSON Schema (has type or properties)
  if (
    typeof propsOrSchema === "object" &&
    propsOrSchema !== null &&
    ("type" in propsOrSchema || "properties" in propsOrSchema)
  ) {
    return { type: "json", schema: propsOrSchema };
  }

  // Check if it's a WidgetProps object (has properties but different structure)
  if (
    typeof propsOrSchema === "object" &&
    propsOrSchema !== null &&
    !("_def" in propsOrSchema)
  ) {
    return { type: "widgetProps", schema: propsOrSchema };
  }

  return { type: null, schema: null };
}

/**
 * Copy specific metadata fields from source to target
 *
 * @param source - Source metadata object
 * @param target - Target metadata object
 * @param fields - Fields to copy
 */
export function copyMetadataFields(
  source: Record<string, unknown> | undefined,
  target: Record<string, unknown>,
  fields: readonly string[]
): void {
  if (!source) return;

  for (const field of fields) {
    if (source[field] !== undefined) {
      target[field] = source[field];
    }
  }
}

/**
 * Deep merge UI metadata objects
 *
 * @param existing - Existing metadata
 * @param incoming - Incoming metadata to merge
 * @returns Merged metadata or undefined if both are empty
 */
export function deepMergeUiMetadata(
  existing: Record<string, unknown> | undefined,
  incoming: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!existing && !incoming) return undefined;
  if (!existing) return incoming;
  if (!incoming) return existing;

  return {
    ...existing,
    ...incoming,
    // Deep merge nested objects if needed
    ...(existing.ui && incoming.ui
      ? { ui: { ...existing.ui, ...incoming.ui } }
      : {}),
  };
}

/**
 * Get build ID suffix for URIs
 *
 * @param buildId - Optional build ID
 * @returns Build ID part (e.g., "-abc123" or "")
 */
export function getBuildIdPart(buildId: string | undefined): string {
  return buildId ? `-${buildId}` : "";
}
