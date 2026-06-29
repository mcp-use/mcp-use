/**
 * Base Protocol Adapter
 *
 * Abstract base class for protocol adapters that reduces duplication
 * by extracting common metadata building and CSP transformation logic.
 */

import type { ProtocolAdapter, CSPConfig } from "./types.js";
import type { UIResourceDefinition } from "../../types/resource.js";

/**
 * Extracted metadata fields from a UI resource definition
 */
interface ExtractedMetadata {
  csp?: CSPConfig;
  prefersBorder?: boolean;
  domain?: string;
  [key: string]: unknown;
}

/**
 * Abstract base adapter providing shared functionality
 *
 * Subclasses must implement:
 * - Protocol-specific metadata key naming (transformMetadataKey)
 * - CSP field transformation (transformCSPField)
 * - Metadata wrapping/namespacing (wrapResourceMetadata)
 */
export abstract class BaseProtocolAdapter implements ProtocolAdapter {
  abstract readonly mimeType: string;
  abstract readonly protocol: "mcp-apps" | "apps-sdk";

  /**
   * Transform a metadata key to protocol-specific format
   * e.g., "prefersBorder" → "openai/widgetPrefersBorder" (Apps SDK)
   *       "prefersBorder" → "prefersBorder" (MCP Apps)
   */
  protected abstract transformMetadataKey(key: string): string;

  /**
   * Transform a CSP field name to protocol-specific format
   * e.g., "connectDomains" → "connect_domains" (Apps SDK)
   *       "connectDomains" → "connectDomains" (MCP Apps)
   */
  protected abstract transformCSPField(field: string): string;

  /**
   * Wrap metadata for protocol-specific namespacing
   * e.g., { csp: ... } → { "openai/widgetCSP": ... } (Apps SDK)
   *       { csp: ... } → { ui: { csp: ... } } (MCP Apps)
   */
  protected abstract wrapResourceMetadata(
    meta: Record<string, unknown>
  ): Record<string, unknown>;

  /**
   * Get protocol-specific metadata source field name
   * e.g., "appsSdkMetadata" for Apps SDK, undefined for MCP Apps
   */
  protected abstract getProtocolMetadataField(): "appsSdkMetadata" | undefined;

  /**
   * Build resource metadata using shared logic
   */
  buildResourceMetadata(definition: UIResourceDefinition): {
    mimeType: string;
    _meta?: Record<string, unknown>;
  } {
    const extracted = this.extractMetadata(definition);
    const transformed = this.transformExtractedMetadata(extracted);

    const result: { mimeType: string; _meta?: Record<string, unknown> } = {
      mimeType: this.mimeType,
    };

    if (Object.keys(transformed).length > 0) {
      result._meta = this.wrapResourceMetadata(transformed);
    }

    return result;
  }

  /**
   * Extract metadata from definition, checking both unified and protocol-specific sources
   */
  protected extractMetadata(
    definition: UIResourceDefinition
  ): ExtractedMetadata {
    const meta: ExtractedMetadata = {};

    // Extract CSP
    if ("metadata" in definition && definition.metadata?.csp) {
      meta.csp = definition.metadata.csp;
    }

    // Extract prefersBorder
    if (
      "metadata" in definition &&
      definition.metadata?.prefersBorder !== undefined
    ) {
      meta.prefersBorder = definition.metadata.prefersBorder;
    }

    // Extract domain
    if ("metadata" in definition && definition.metadata?.domain) {
      meta.domain = definition.metadata.domain;
    }

    // Extract additional fields from metadata
    if ("metadata" in definition && definition.metadata) {
      for (const [key, value] of Object.entries(definition.metadata)) {
        if (
          !["csp", "prefersBorder", "domain"].includes(key) &&
          value !== undefined
        ) {
          meta[key] = value;
        }
      }
    }

    return meta;
  }

  /**
   * Transform extracted metadata to protocol-specific format
   */
  protected transformExtractedMetadata(
    meta: ExtractedMetadata
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    // Transform CSP
    if (meta.csp) {
      const transformed = this.transformCSPBase(meta.csp);
      if (Object.keys(transformed).length > 0) {
        result[this.transformMetadataKey("csp")] = transformed;
      }
    }

    // Transform prefersBorder
    if (meta.prefersBorder !== undefined) {
      result[this.transformMetadataKey("prefersBorder")] = meta.prefersBorder;
    }

    // Transform domain
    if (meta.domain) {
      result[this.transformMetadataKey("domain")] = meta.domain;
    }

    // Transform additional fields
    for (const [key, value] of Object.entries(meta)) {
      if (!["csp", "prefersBorder", "domain"].includes(key)) {
        result[this.transformMetadataKey(key)] = value;
      }
    }

    return result;
  }

  /**
   * Transform CSP config using protocol-specific field naming
   */
  protected transformCSPBase(csp: CSPConfig): Record<string, unknown> {
    const result: Record<string, any> = {};

    // Transform domain lists
    const domainFields = [
      "connectDomains",
      "resourceDomains",
      "frameDomains",
      "baseUriDomains",
      "redirectDomains",
    ];

    for (const field of domainFields) {
      if (
        csp[field as keyof CSPConfig] &&
        Array.isArray(csp[field as keyof CSPConfig]) &&
        (csp[field as keyof CSPConfig] as any[]).length > 0
      ) {
        result[this.transformCSPField(field)] = csp[field as keyof CSPConfig];
      }
    }

    // Transform directives
    if (csp.scriptDirectives && csp.scriptDirectives.length > 0) {
      result[this.transformCSPField("scriptDirectives")] = csp.scriptDirectives;
    }

    if (csp.styleDirectives && csp.styleDirectives.length > 0) {
      result[this.transformCSPField("styleDirectives")] = csp.styleDirectives;
    }

    // Pass through any additional properties
    for (const [key, value] of Object.entries(csp)) {
      if (
        ![...domainFields, "scriptDirectives", "styleDirectives"].includes(
          key
        ) &&
        value !== undefined
      ) {
        result[this.transformCSPField(key)] = value;
      }
    }

    return result;
  }

  // Subclasses must implement buildToolMetadata as it's protocol-specific
  abstract buildToolMetadata(
    definition: UIResourceDefinition,
    uri: string
  ): Record<string, unknown>;
}
