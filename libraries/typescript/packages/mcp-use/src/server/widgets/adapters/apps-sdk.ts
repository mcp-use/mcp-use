/**
 * ChatGPT Apps SDK Protocol Adapter
 *
 * Generates metadata for OpenAI's ChatGPT Apps SDK.
 * Uses snake_case naming and openai/* prefixed keys.
 *
 * @see https://developers.openai.com/apps-sdk
 */

import type { ProtocolAdapter, CSPConfig } from "./types.js";
import type {
  UIResourceDefinition,
  AppsSdkMetadata,
} from "../../types/resource.js";

/**
 * Apps SDK protocol adapter
 *
 * Transforms unified widget definitions into Apps SDK format:
 * - MIME type: "text/html+skybridge"
 * - Metadata: _meta["openai/*"] prefixed keys
 * - CSP: snake_case keys (connect_domains, resource_domains, etc.)
 */
export class AppsSdkAdapter implements ProtocolAdapter {
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
   * Build resource metadata for Apps SDK protocol
   */
  buildResourceMetadata(definition: UIResourceDefinition): {
    mimeType: string;
    _meta?: Record<string, unknown>;
  } {
    const meta: AppsSdkMetadata = {};

    // Add CSP if specified
    if ("metadata" in definition && definition.metadata?.csp) {
      const csp = this.transformCSP(definition.metadata.csp);
      if (csp && Object.keys(csp).length > 0) {
        meta["openai/widgetCSP"] = csp;
      }
    } else if (
      "appsSdkMetadata" in definition &&
      definition.appsSdkMetadata?.["openai/widgetCSP"]
    ) {
      // Use existing appsSdkMetadata CSP if available
      meta["openai/widgetCSP"] = definition.appsSdkMetadata["openai/widgetCSP"];
    }

    // Add prefersBorder if specified
    if (
      "metadata" in definition &&
      definition.metadata?.prefersBorder !== undefined
    ) {
      meta["openai/widgetPrefersBorder"] = definition.metadata.prefersBorder;
    } else if (
      "appsSdkMetadata" in definition &&
      definition.appsSdkMetadata?.["openai/widgetPrefersBorder"] !== undefined
    ) {
      meta["openai/widgetPrefersBorder"] =
        definition.appsSdkMetadata["openai/widgetPrefersBorder"];
    }

    // Add domain if specified
    if ("metadata" in definition && definition.metadata?.domain) {
      meta["openai/widgetDomain"] = definition.metadata.domain;
    } else if (
      "appsSdkMetadata" in definition &&
      definition.appsSdkMetadata?.["openai/widgetDomain"]
    ) {
      meta["openai/widgetDomain"] =
        definition.appsSdkMetadata["openai/widgetDomain"];
    }

    // Add widgetDescription if specified (ChatGPT-specific)
    if ("metadata" in definition && definition.metadata?.widgetDescription) {
      meta["openai/widgetDescription"] = definition.metadata.widgetDescription;
    } else if (
      "appsSdkMetadata" in definition &&
      definition.appsSdkMetadata?.["openai/widgetDescription"]
    ) {
      meta["openai/widgetDescription"] =
        definition.appsSdkMetadata["openai/widgetDescription"];
    }

    // Add widgetAccessible if specified
    if (
      "appsSdkMetadata" in definition &&
      definition.appsSdkMetadata?.["openai/widgetAccessible"] !== undefined
    ) {
      meta["openai/widgetAccessible"] =
        definition.appsSdkMetadata["openai/widgetAccessible"];
    }

    // Add locale if specified
    if (
      "appsSdkMetadata" in definition &&
      definition.appsSdkMetadata?.["openai/locale"]
    ) {
      meta["openai/locale"] = definition.appsSdkMetadata["openai/locale"];
    }

    const result: {
      mimeType: string;
      _meta?: Record<string, unknown>;
    } = {
      mimeType: this.mimeType,
    };

    if (Object.keys(meta).length > 0) {
      result._meta = meta;
    }

    return result;
  }

  /**
   * Transform CSP config to Apps SDK format (snake_case)
   */
  private transformCSP(csp: CSPConfig): AppsSdkMetadata["openai/widgetCSP"] {
    const result: NonNullable<AppsSdkMetadata["openai/widgetCSP"]> = {
      connect_domains: [],
      resource_domains: [],
    };

    if (csp.connectDomains && csp.connectDomains.length > 0) {
      result.connect_domains = csp.connectDomains;
    }

    if (csp.resourceDomains && csp.resourceDomains.length > 0) {
      result.resource_domains = csp.resourceDomains;
    }

    if (csp.frameDomains && csp.frameDomains.length > 0) {
      result.frame_domains = csp.frameDomains;
    }

    if (csp.redirectDomains && csp.redirectDomains.length > 0) {
      result.redirect_domains = csp.redirectDomains;
    }

    // Add CSP directives (e.g., 'unsafe-eval', 'unsafe-inline')
    if (csp.scriptDirectives && csp.scriptDirectives.length > 0) {
      (result as any).script_directives = csp.scriptDirectives;
    }

    if (csp.styleDirectives && csp.styleDirectives.length > 0) {
      (result as any).style_directives = csp.styleDirectives;
    }

    return result;
  }
}
