/**
 * ChatGPT Apps SDK Protocol Adapter
 *
 * Generates metadata for OpenAI's ChatGPT Apps SDK.
 * Uses snake_case naming and openai/* prefixed keys.
 *
 * @see https://developers.openai.com/apps-sdk
 */

import { BaseProtocolAdapter } from "./base.js";
import type { UIResourceDefinition } from "../../types/resource.js";

/**
 * Apps SDK protocol adapter
 *
 * Transforms unified widget definitions into Apps SDK format:
 * - MIME type: "text/html+skybridge"
 * - Metadata: _meta["openai/*"] prefixed keys
 * - CSP: snake_case keys (connect_domains, resource_domains, etc.)
 */
export class AppsSdkAdapter extends BaseProtocolAdapter {
  readonly mimeType = "text/html+skybridge";
  readonly protocol = "apps-sdk" as const;

  /**
   * Build tool metadata for Apps SDK protocol
   */
  buildToolMetadata(
    definition: UIResourceDefinition,
    uri: string
  ): Record<string, unknown> {
    const meta: Record<string, unknown> = {
      "openai/outputTemplate": uri,
    };

    // Add tool-level metadata from appsSdkMetadata
    if ("appsSdkMetadata" in definition && definition.appsSdkMetadata) {
      const appsMeta = definition.appsSdkMetadata;

      // Copy tool-relevant metadata fields
      const toolFields = [
        "openai/toolInvocation/invoking",
        "openai/toolInvocation/invoked",
        "openai/widgetAccessible",
        "openai/resultCanProduceWidget",
      ] as const;

      for (const field of toolFields) {
        if (appsMeta[field] !== undefined) {
          meta[field] = appsMeta[field];
        }
      }
    }

    return meta;
  }

  /**
   * Transform metadata key to Apps SDK format (openai/* prefix)
   */
  protected transformMetadataKey(key: string): string {
    const keyMap: Record<string, string> = {
      csp: "openai/widgetCSP",
      prefersBorder: "openai/widgetPrefersBorder",
      domain: "openai/widgetDomain",
      widgetDescription: "openai/widgetDescription",
      widgetAccessible: "openai/widgetAccessible",
      locale: "openai/locale",
    };
    return keyMap[key] || `openai/${key}`;
  }

  /**
   * Transform CSP field to snake_case
   */
  protected transformCSPField(field: string): string {
    return field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  }

  /**
   * Wrap metadata - Apps SDK uses flat structure with openai/* keys
   */
  protected wrapResourceMetadata(
    meta: Record<string, unknown>
  ): Record<string, unknown> {
    return meta; // Already has openai/* keys from transformMetadataKey
  }

  /**
   * Get protocol-specific metadata field name
   */
  protected getProtocolMetadataField(): "appsSdkMetadata" | undefined {
    return "appsSdkMetadata";
  }

  /**
   * Override to add Apps SDK-specific metadata sources
   */
  buildResourceMetadata(definition: UIResourceDefinition): {
    mimeType: string;
    _meta?: Record<string, unknown>;
  } {
    // Use base implementation
    const result = super.buildResourceMetadata(definition);

    // Add fallback to appsSdkMetadata for fields not in unified metadata
    if ("appsSdkMetadata" in definition && definition.appsSdkMetadata) {
      const appsMeta = definition.appsSdkMetadata;
      result._meta = result._meta || {};

      // Copy additional Apps SDK-specific fields
      const additionalFields = [
        "openai/widgetAccessible",
        "openai/locale",
        "openai/widgetCSP",
        "openai/widgetPrefersBorder",
        "openai/widgetDomain",
        "openai/widgetDescription",
      ];

      for (const field of additionalFields) {
        if (!(field in result._meta) && appsMeta[field] !== undefined) {
          result._meta[field] = appsMeta[field];
        }
      }
    }

    return result;
  }
}
