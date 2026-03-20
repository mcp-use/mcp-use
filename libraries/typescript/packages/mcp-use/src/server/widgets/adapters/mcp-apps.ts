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
import { BaseProtocolAdapter } from "./base.js";
import type { UIResourceDefinition } from "../../types/resource.js";

/**
 * MCP Apps protocol adapter
 *
 * Transforms unified widget definitions into MCP Apps format:
 * - MIME type: "text/html;profile=mcp-app"
 * - Metadata: _meta.ui.* namespace
 * - CSP: camelCase keys (connectDomains, resourceDomains)
 * - Also includes legacy _meta["ui/resourceUri"] for backward compatibility
 */
export class McpAppsAdapter extends BaseProtocolAdapter {
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
   * Transform metadata key to MCP Apps format (keep camelCase)
   */
  protected transformMetadataKey(key: string): string {
    return key; // MCP Apps uses camelCase as-is
  }

  /**
   * Transform CSP field (keep camelCase)
   */
  protected transformCSPField(field: string): string {
    return field; // MCP Apps uses camelCase as-is
  }

  /**
   * Wrap metadata - MCP Apps uses _meta.ui namespace
   */
  protected wrapResourceMetadata(
    meta: Record<string, unknown>
  ): Record<string, unknown> {
    return { ui: meta };
  }

  /**
   * Get protocol-specific metadata field name
   */
  protected getProtocolMetadataField(): undefined {
    return undefined; // MCP Apps doesn't have a separate protocol metadata field
  }
}
