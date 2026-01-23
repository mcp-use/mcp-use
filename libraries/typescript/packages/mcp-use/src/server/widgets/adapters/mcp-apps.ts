/**
 * MCP Apps Protocol Adapter
 *
 * Generates metadata for the official MCP Apps Extension (SEP-1865).
 * Uses camelCase naming and _meta.ui.* namespace.
 *
 * @see https://github.com/modelcontextprotocol/ext-apps
 * @see https://blog.modelcontextprotocol.io/posts/2025-11-21-mcp-apps/
 */

import {
  RESOURCE_URI_META_KEY,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import type { ProtocolAdapter, CSPConfig } from "./types.js";
import type { UIResourceDefinition } from "../../types/resource.js";

/**
 * MCP UI Resource Metadata (from SEP-1865 spec)
 * Defined locally to avoid import issues with ext-apps package structure
 */
interface McpUiResourceCsp {
  connectDomains?: string[];
  resourceDomains?: string[];
  frameDomains?: string[];
  baseUriDomains?: string[];
  /** Allow arbitrary additional properties for future spec evolution */
  [key: string]: any;
}

interface McpUiResourceMeta {
  csp?: McpUiResourceCsp;
  domain?: string;
  prefersBorder?: boolean;

  /**
   * Sandbox permissions requested by the UI (SEP-1865)
   */
  permissions?: {
    camera?: Record<string, never>;
    microphone?: Record<string, never>;
    geolocation?: Record<string, never>;
    clipboardWrite?: Record<string, never>;
    [key: string]: any;
  };

  /** Allow arbitrary additional properties for future spec evolution (includes autoResize) */
  [key: string]: any;
}

/**
 * MCP Apps protocol adapter
 *
 * Transforms unified widget definitions into MCP Apps format:
 * - MIME type: "text/html;profile=mcp-app"
 * - Metadata: _meta.ui.* namespace
 * - CSP: camelCase keys (connectDomains, resourceDomains)
 * - Also includes legacy _meta["ui/resourceUri"] for backward compatibility
 */
export class McpAppsAdapter implements ProtocolAdapter {
  readonly mimeType = RESOURCE_MIME_TYPE;
  readonly protocol = "mcp-apps" as const;

  /**
   * Build tool metadata for MCP Apps protocol
   */
  buildToolMetadata(
    definition: UIResourceDefinition,
    uri: string
  ): Record<string, unknown> {
    const meta: Record<string, unknown> = {
      // New format (nested)
      ui: {
        resourceUri: uri,
      },
      // Legacy format (flat) for backward compatibility with older clients
      [RESOURCE_URI_META_KEY]: uri,
    };

    return meta;
  }

  /**
   * Build resource metadata for MCP Apps protocol
   */
  buildResourceMetadata(definition: UIResourceDefinition): {
    mimeType: string;
    _meta?: Record<string, unknown>;
  } {
    const uiMeta: McpUiResourceMeta = {};

    // Add CSP if specified
    if ("metadata" in definition && definition.metadata?.csp) {
      const csp = this.transformCSP(definition.metadata.csp);
      if (csp && Object.keys(csp).length > 0) {
        uiMeta.csp = csp;
      }
    }

    // Add prefersBorder if specified
    if (
      "metadata" in definition &&
      definition.metadata?.prefersBorder !== undefined
    ) {
      uiMeta.prefersBorder = definition.metadata.prefersBorder;
    }

    // Add domain if specified
    if ("metadata" in definition && definition.metadata?.domain) {
      uiMeta.domain = definition.metadata.domain;
    }

    // Add permissions if specified (SEP-1865)
    if ("metadata" in definition && definition.metadata?.permissions) {
      uiMeta.permissions = definition.metadata.permissions;
    }

    // Pass through any additional properties from metadata for future compatibility
    // This includes autoResize (legacy MCP-UI) and any future fields
    if ("metadata" in definition && definition.metadata) {
      const knownProps = [
        "csp",
        "prefersBorder",
        "domain",
        "widgetDescription",
        "permissions",
        "description",
      ];
      for (const [key, value] of Object.entries(definition.metadata)) {
        if (!knownProps.includes(key) && value !== undefined) {
          uiMeta[key] = value;
        }
      }
    }

    const result: {
      mimeType: string;
      _meta?: Record<string, unknown>;
    } = {
      mimeType: this.mimeType,
    };

    if (Object.keys(uiMeta).length > 0) {
      result._meta = { ui: uiMeta };
    }

    return result;
  }

  /**
   * Transform CSP config to MCP Apps format (camelCase)
   */
  private transformCSP(csp: CSPConfig): McpUiResourceMeta["csp"] {
    const result: McpUiResourceMeta["csp"] = {};

    if (csp.connectDomains && csp.connectDomains.length > 0) {
      result.connectDomains = csp.connectDomains;
    }

    if (csp.resourceDomains && csp.resourceDomains.length > 0) {
      result.resourceDomains = csp.resourceDomains;
    }

    if (csp.frameDomains && csp.frameDomains.length > 0) {
      result.frameDomains = csp.frameDomains;
    }

    if (csp.baseUriDomains && csp.baseUriDomains.length > 0) {
      result.baseUriDomains = csp.baseUriDomains;
    }

    // Pass through any additional properties for future compatibility
    // Skip known properties and ChatGPT-specific ones (redirectDomains)
    const knownProps = [
      "connectDomains",
      "resourceDomains",
      "frameDomains",
      "baseUriDomains",
      "redirectDomains",
    ];
    for (const [key, value] of Object.entries(csp)) {
      if (!knownProps.includes(key)) {
        result[key] = value;
      }
    }

    return result;
  }
}
