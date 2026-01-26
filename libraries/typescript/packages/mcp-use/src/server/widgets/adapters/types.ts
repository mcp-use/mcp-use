/**
 * UI Resource Protocol Adapter Types
 *
 * Defines the interface for protocol-specific adapters that handle
 * widget registration, metadata building, and tool response generation.
 *
 * Each adapter implements a specific protocol type:
 * - appsSdk: OpenAI Apps SDK (text/html+skybridge)
 * - mcpApp: MCP Apps standard (text/html;profile=mcp-app)
 * - externalUrl: Legacy MCP-UI iframe-based widgets
 * - rawHtml: Legacy MCP-UI raw HTML content
 * - remoteDom: Legacy MCP-UI Remote DOM scripting
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type {
  UIResourceDefinition,
  AppsSdkUIResource,
  McpAppUIResource,
  ExternalUrlUIResource,
  RawHtmlUIResource,
  RemoteDomUIResource,
} from "../../types/index.js";
import type { UIResourceServer } from "../ui-resource-registration.js";

/**
 * Server configuration passed to adapters
 */
export interface AdapterServerConfig {
  /** Server host */
  serverHost: string;
  /** Server port */
  serverPort: number;
  /** Server base URL (if configured) */
  serverBaseUrl?: string;
  /** Build ID for cache busting */
  buildId?: string;
}

/**
 * UI Resource metadata structure stored in widgetDefinitions
 */
export interface UIResourceMeta extends Record<string, unknown> {
  /** Widget type identifier */
  "mcp-use/widgetType"?: string;
}

/**
 * Tool response structure returned by adapters
 */
export interface AdapterToolResponse extends CallToolResult {
  /** Metadata for the tool response */
  _meta?: Record<string, unknown>;
  /** Structured content for widget data */
  structuredContent?: Record<string, unknown>;
}

/**
 * Common interface for UI resource protocol adapters
 *
 * Each adapter handles one protocol type and provides methods for:
 * - Building metadata for resources and tools
 * - Registering resources and templates
 * - Generating tool responses
 *
 * Note: Methods accept UIResourceDefinition (the union type) to allow
 * flexibility when the specific type isn't known at compile time.
 * Implementations should assert the correct type internally.
 */
export interface UIResourceProtocolAdapter<
  T extends UIResourceDefinition = UIResourceDefinition,
> {
  /** Protocol type this adapter handles */
  readonly type: T["type"];

  /** MIME type for resources of this protocol */
  readonly mimeType: string;

  /**
   * Build metadata for the tool
   *
   * This metadata is attached to the tool definition and controls
   * how the tool integrates with the host (e.g., Apps SDK, MCP Apps).
   *
   * @param definition - UI resource definition
   * @param serverConfig - Server configuration
   * @returns Tool metadata object
   */
  buildToolMeta(
    definition: UIResourceDefinition,
    serverConfig: AdapterServerConfig
  ): Record<string, unknown>;

  /**
   * Build metadata for the UI resource
   *
   * This metadata is stored in widgetDefinitions and used to inject
   * widget configuration into tool responses.
   *
   * @param definition - UI resource definition
   * @param serverConfig - Server configuration
   * @returns UI resource metadata
   */
  buildUIResourceMeta(
    definition: UIResourceDefinition,
    serverConfig: AdapterServerConfig
  ): UIResourceMeta;

  /**
   * Register resources and templates for this widget
   *
   * Each protocol may register different combinations of:
   * - Static resources
   * - Resource templates (for dynamic URIs)
   * - Dual registrations (e.g., Apps SDK + MCP App)
   *
   * @param server - MCP server instance
   * @param definition - UI resource definition
   * @param serverConfig - Server configuration
   */
  registerResources(
    server: UIResourceServer,
    definition: UIResourceDefinition,
    serverConfig: AdapterServerConfig
  ): void;

  /**
   * Build the tool response for this widget
   *
   * Called when the tool is invoked. Returns the appropriate response
   * format for the protocol type.
   *
   * @param definition - UI resource definition
   * @param params - Tool parameters from the invocation
   * @param serverConfig - Server configuration
   * @returns Tool response with content and metadata
   */
  buildToolResponse(
    definition: UIResourceDefinition,
    params: Record<string, unknown>,
    serverConfig: AdapterServerConfig
  ): Promise<AdapterToolResponse>;

  /**
   * Generate the resource URI for this widget
   *
   * @param definition - UI resource definition
   * @param buildId - Optional build ID for cache busting
   * @returns Resource URI string
   */
  generateResourceUri(
    definition: UIResourceDefinition,
    buildId?: string
  ): string;
}

/**
 * Type alias for Apps SDK adapter
 */
export type AppsSdkAdapter = UIResourceProtocolAdapter<AppsSdkUIResource>;

/**
 * Type alias for MCP App adapter
 */
export type McpAppAdapter = UIResourceProtocolAdapter<McpAppUIResource>;

/**
 * Type alias for External URL adapter
 */
export type ExternalUrlAdapter =
  UIResourceProtocolAdapter<ExternalUrlUIResource>;

/**
 * Type alias for Raw HTML adapter
 */
export type RawHtmlAdapter = UIResourceProtocolAdapter<RawHtmlUIResource>;

/**
 * Type alias for Remote DOM adapter
 */
export type RemoteDomAdapter = UIResourceProtocolAdapter<RemoteDomUIResource>;

/**
 * Union of all protocol adapter types
 */
export type AnyProtocolAdapter =
  | AppsSdkAdapter
  | McpAppAdapter
  | ExternalUrlAdapter
  | RawHtmlAdapter
  | RemoteDomAdapter;

/**
 * Map of protocol types to their adapters
 */
export type ProtocolAdapterMap = {
  appsSdk: AppsSdkAdapter;
  mcpApp: McpAppAdapter;
  externalUrl: ExternalUrlAdapter;
  rawHtml: RawHtmlAdapter;
  remoteDom: RemoteDomAdapter;
};
