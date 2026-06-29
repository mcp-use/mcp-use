/**
 * UI resource builders for Apps SDK and MCP Apps widgets.
 */

import type {
  AppsSdkMetadata,
  UIResourceContent,
  UIResourceDefinition,
} from "../types/resource.js";
import { slugifyWidgetName } from "./widget-helpers.js";

/**
 * Configuration for building widget URLs
 */
export interface UrlConfig {
  baseUrl: string;
  port: number | string;
  buildId?: string;
}

/**
 * Build the full URL for a widget including query parameters
 */
export function buildWidgetUrl(
  widget: string,
  props: Record<string, unknown> | undefined,
  config: UrlConfig
): string {
  const slugifiedWidget = slugifyWidgetName(widget);

  const url = new URL(
    `/mcp-use/widgets/${slugifiedWidget}`,
    `${config.baseUrl}:${config.port}`
  );

  if (props && Object.keys(props).length > 0) {
    url.searchParams.set("props", JSON.stringify(props));
  }

  return url.toString();
}

function createHtmlUIResource(
  uri: string,
  htmlTemplate: string,
  mimeType: string,
  _meta?: Record<string, unknown>
): UIResourceContent {
  const resource: Record<string, unknown> = {
    uri,
    mimeType,
    text: htmlTemplate,
  };
  if (_meta && Object.keys(_meta).length > 0) {
    resource._meta = _meta;
  }
  return {
    type: "resource",
    resource: resource as UIResourceContent["resource"],
  };
}

function createAppsSdkResource(
  uri: string,
  htmlTemplate: string,
  metadata?: AppsSdkMetadata
): UIResourceContent {
  return createHtmlUIResource(
    uri,
    htmlTemplate,
    "text/html+skybridge",
    metadata && Object.keys(metadata).length > 0 ? metadata : undefined
  );
}

/**
 * Create a UIResource for MCP Apps Extension (SEP-1865)
 */
export function createMcpAppsResource(
  uri: string,
  htmlTemplate: string,
  metadata?: {
    description?: string;
    csp?: {
      connectDomains?: string[];
      resourceDomains?: string[];
      frameDomains?: string[];
      baseUriDomains?: string[];
    };
    prefersBorder?: boolean;
    domain?: string;
  }
): UIResourceContent {
  if (!metadata || Object.keys(metadata).length === 0) {
    return createHtmlUIResource(uri, htmlTemplate, "text/html;profile=mcp-app");
  }

  const uiMeta: Record<string, unknown> = {};
  if (metadata.csp && Object.keys(metadata.csp).length > 0) {
    uiMeta.csp = metadata.csp;
  }
  if (metadata.prefersBorder !== undefined) {
    uiMeta.prefersBorder = metadata.prefersBorder;
  }
  if (metadata.domain) {
    uiMeta.domain = metadata.domain;
  }

  return createHtmlUIResource(
    uri,
    htmlTemplate,
    "text/html;profile=mcp-app",
    Object.keys(uiMeta).length > 0 ? { ui: uiMeta } : undefined
  );
}

/**
 * Create a UIResource from a high-level definition (appsSdk or mcpApps only).
 */
export async function createUIResourceFromDefinition(
  definition: UIResourceDefinition,
  _params: Record<string, unknown>,
  config: UrlConfig
): Promise<UIResourceContent> {
  const buildIdPart = config.buildId ? `-${config.buildId}` : "";
  const uri = `ui://widget/${definition.name}${buildIdPart}.html`;

  switch (definition.type) {
    case "appsSdk":
      return createAppsSdkResource(
        uri,
        definition.htmlTemplate,
        definition.appsSdkMetadata
      );

    case "mcpApps":
      return createMcpAppsResource(
        uri,
        definition.htmlTemplate,
        definition.metadata
      );

    default: {
      const _exhaustive: never = definition;
      const unexpected = _exhaustive as unknown as { type?: unknown };
      throw new Error(`Unknown UI resource type: ${String(unexpected.type)}`);
    }
  }
}
