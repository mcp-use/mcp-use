/**
 * UI Resource Protocol Adapters
 *
 * Provides protocol-specific adapters for widget registration and
 * a factory function to select the appropriate adapter.
 *
 * Each adapter handles one protocol type:
 * - appsSdk: OpenAI Apps SDK (text/html+skybridge)
 * - mcpApp: MCP Apps standard (text/html;profile=mcp-app)
 * - externalUrl: Legacy MCP-UI iframe-based widgets
 * - rawHtml: Legacy MCP-UI raw HTML content
 * - remoteDom: Legacy MCP-UI Remote DOM scripting
 *
 * Usage:
 * ```typescript
 * import { getProtocolAdapter } from './adapters';
 *
 * const adapter = getProtocolAdapter('appsSdk');
 * adapter.registerResources(server, definition, serverConfig);
 * ```
 */

// Export types
export type {
  UIResourceProtocolAdapter,
  AdapterServerConfig,
  UIResourceMeta,
  AdapterToolResponse,
  AppsSdkAdapter,
  McpAppAdapter,
  ExternalUrlAdapter,
  RawHtmlAdapter,
  RemoteDomAdapter,
  AnyProtocolAdapter,
  ProtocolAdapterMap,
} from "./types.js";

// Export adapter classes
export { AppsSdkProtocolAdapter, appsSdkAdapter } from "./apps-sdk-adapter.js";

export { McpAppProtocolAdapter, mcpAppAdapter } from "./mcp-app-adapter.js";

export {
  ExternalUrlProtocolAdapter,
  externalUrlAdapter,
} from "./external-url-adapter.js";

export { RawHtmlProtocolAdapter, rawHtmlAdapter } from "./raw-html-adapter.js";

export {
  RemoteDomProtocolAdapter,
  remoteDomAdapter,
} from "./remote-dom-adapter.js";

// Import singleton instances for factory
import { appsSdkAdapter } from "./apps-sdk-adapter.js";
import { mcpAppAdapter } from "./mcp-app-adapter.js";
import { externalUrlAdapter } from "./external-url-adapter.js";
import { rawHtmlAdapter } from "./raw-html-adapter.js";
import { remoteDomAdapter } from "./remote-dom-adapter.js";
import type { AnyProtocolAdapter } from "./types.js";

/**
 * Protocol type literals
 */
export type ProtocolType =
  | "appsSdk"
  | "mcpApp"
  | "externalUrl"
  | "rawHtml"
  | "remoteDom";

/**
 * Map of protocol types to their adapter instances
 */
const adapterMap: Record<ProtocolType, AnyProtocolAdapter> = {
  appsSdk: appsSdkAdapter,
  mcpApp: mcpAppAdapter,
  externalUrl: externalUrlAdapter,
  rawHtml: rawHtmlAdapter,
  remoteDom: remoteDomAdapter,
};

/**
 * Get the protocol adapter for a given type
 *
 * @param type - Protocol type identifier
 * @returns The appropriate adapter instance
 * @throws Error if the protocol type is not supported
 *
 * @example
 * ```typescript
 * const adapter = getProtocolAdapter('appsSdk');
 * const toolMeta = adapter.buildToolMeta(definition, serverConfig);
 * ```
 */
export function getProtocolAdapter(type: ProtocolType): AnyProtocolAdapter {
  const adapter = adapterMap[type];
  if (!adapter) {
    throw new Error(
      `Unsupported UI resource type: ${type}. ` +
        `Must be one of: ${Object.keys(adapterMap).join(", ")}`
    );
  }
  return adapter;
}

/**
 * Check if a protocol type is supported
 *
 * @param type - Protocol type to check
 * @returns true if the type is supported
 */
export function isValidProtocolType(type: string): type is ProtocolType {
  return type in adapterMap;
}

/**
 * Get all supported protocol types
 *
 * @returns Array of supported protocol types
 */
export function getSupportedProtocolTypes(): ProtocolType[] {
  return Object.keys(adapterMap) as ProtocolType[];
}
