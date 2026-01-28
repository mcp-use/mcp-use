/**
 * Protocol adapter types for dual-protocol widget support
 *
 * Adapters transform unified widget definitions into protocol-specific
 * formats for MCP Apps (SEP-1865) and ChatGPT Apps SDK.
 */

import type { UIResourceDefinition } from "../../types/resource.js";

/**
 * Protocol adapter interface
 *
 * Implementations transform unified widget metadata into protocol-specific
 * formats (MCP Apps or ChatGPT Apps SDK).
 */
export interface ProtocolAdapter {
  /**
   * MIME type for this protocol
   * - MCP Apps: "text/html;profile=mcp-app"
   * - Apps SDK: "text/html+skybridge"
   */
  readonly mimeType: string;

  /**
   * Protocol identifier
   */
  readonly protocol: "mcp-apps" | "apps-sdk";

  /**
   * Build tool metadata for this protocol
   *
   * @param definition - Widget definition
   * @param uri - Resource URI
   * @returns Protocol-specific tool metadata
   */
  buildToolMetadata(
    definition: UIResourceDefinition,
    uri: string
  ): Record<string, unknown>;

  /**
   * Build resource metadata for this protocol
   *
   * @param definition - Widget definition
   * @returns Protocol-specific resource metadata (includes mimeType and _meta)
   */
  buildResourceMetadata(definition: UIResourceDefinition): {
    mimeType: string;
    _meta?: Record<string, unknown>;
  };
}

/**
 * CSP configuration (unified format)
 *
 * Maps to protocol-specific CSP formats:
 * - MCP Apps: camelCase (connectDomains, resourceDomains)
 * - Apps SDK: snake_case (connect_domains, resource_domains)
 *
 * Follows SEP-1865 specification with support for arbitrary additional properties.
 */
export interface CSPConfig {
  /**
   * Domains allowed for fetch/XHR/WebSocket connections
   */
  connectDomains?: string[];

  /**
   * Domains allowed for images, scripts, stylesheets, fonts
   */
  resourceDomains?: string[];

  /**
   * Allowed iframe origins
   */
  frameDomains?: string[];

  /**
   * Allowed base URIs for the document (SEP-1865)
   */
  baseUriDomains?: string[];

  /**
   * Domains for openExternal without confirmation modal
   * (ChatGPT only - not in SEP-1865)
   */
  redirectDomains?: string[];

  /**
   * CSP directive literals to include in script-src
   * (e.g., 'unsafe-eval', 'unsafe-inline', 'unsafe-hashes')
   *
   * Use with caution - these weaken security but may be needed for
   * certain frameworks or development tools.
   *
   * @example
   * scriptDirectives: ["'unsafe-eval'"]
   */
  scriptDirectives?: string[];

  /**
   * CSP directive literals to include in style-src
   * (e.g., 'unsafe-inline', 'unsafe-hashes')
   *
   * @example
   * styleDirectives: ["'unsafe-inline'"]
   */
  styleDirectives?: string[];

  /**
   * Allow arbitrary additional properties for future spec evolution
   */
  [key: string]: any;
}

/**
 * Unified widget metadata (protocol-agnostic)
 *
 * This is transformed by adapters into protocol-specific formats.
 * Follows SEP-1865 specification with support for arbitrary additional properties.
 */
export interface UnifiedWidgetMetadata {
  /** Description of the widget */
  description?: string;

  /** Content Security Policy */
  csp?: CSPConfig;

  /** Request a visible border around the widget */
  prefersBorder?: boolean;

  /** Dedicated domain for widget isolation */
  domain?: string;

  /** Human-readable summary for the AI model (ChatGPT only) */
  widgetDescription?: string;

  /**
   * Sandbox permissions requested by the UI (SEP-1865)
   *
   * Servers declare which browser capabilities their UI needs.
   * Hosts MAY honor these by setting appropriate iframe `allow` attributes.
   */
  permissions?: {
    /** Request camera access */
    camera?: Record<string, never>;
    /** Request microphone access */
    microphone?: Record<string, never>;
    /** Request geolocation access */
    geolocation?: Record<string, never>;
    /** Request clipboard write access */
    clipboardWrite?: Record<string, never>;
    /** Allow future permission types */
    [key: string]: any;
  };

  /** Enable automatic size change notifications (legacy MCP-UI, still supported) */
  autoResize?: boolean;

  /**
   * Allow arbitrary additional properties for future spec evolution
   */
  [key: string]: any;
}
