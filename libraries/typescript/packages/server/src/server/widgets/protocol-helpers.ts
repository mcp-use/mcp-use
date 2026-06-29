/**
 * Protocol Helper Functions
 *
 * Shared utilities for dual-protocol metadata building and widget URI generation.
 * Reduces duplication in ui-resource-registration.ts
 */

import { createHash } from "node:crypto";
import type { Implementation } from "@modelcontextprotocol/sdk/types.js";

import { McpAppsAdapter } from "./adapters/mcp-apps.js";
import { AppsSdkAdapter } from "./adapters/apps-sdk.js";
import type { UIResourceDefinition } from "../types/resource.js";

/**
 * Create singleton instances of protocol adapters
 */
function createProtocolAdapters() {
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

export function isClaudeClient(clientInfo: Implementation): boolean {
  return clientInfo.name.toLowerCase().includes("claude");
}

export function computeClaudeResourceDomain(domain: string): string {
  if (domain.endsWith(".claudemcpcontent.com")) {
    return domain;
  }

  return `${createHash("sha256")
    .update(domain)
    .digest("hex")
    .slice(0, 32)}.claudemcpcontent.com`;
}

export function getMcpUiResourceDomain(resource: {
  _meta?: Record<string, unknown>;
}): string | undefined {
  const uiMeta = resource._meta?.ui as Record<string, unknown> | undefined;
  const domain = uiMeta?.domain;
  return typeof domain === "string" && domain.length > 0 ? domain : undefined;
}

export function applyClaudeResourceDomain(
  resource: { _meta?: Record<string, unknown> },
  clientInfo: Implementation
): void {
  if (!isClaudeClient(clientInfo)) {
    return;
  }

  const domain = getMcpUiResourceDomain(resource);
  if (!domain) {
    return;
  }

  resource._meta = resource._meta ?? {};
  const uiMeta = resource._meta.ui as Record<string, unknown> | undefined;
  resource._meta.ui = {
    ...uiMeta,
    domain: computeClaudeResourceDomain(domain),
  };
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
 * Get build ID suffix for URIs
 *
 * @param buildId - Optional build ID
 * @returns Build ID part (e.g., "-abc123" or "")
 */
export function getBuildIdPart(buildId: string | undefined): string {
  return buildId ? `-${buildId}` : "";
}
