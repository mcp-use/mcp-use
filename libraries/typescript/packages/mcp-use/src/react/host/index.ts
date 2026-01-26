/**
 * Host Adaptor Module
 *
 * Provides runtime host detection and adaptor creation for widget development.
 * Supports three host environments:
 *
 * - apps-sdk: OpenAI Apps SDK (ChatGPT native widgets)
 * - mcp-app: MCP Apps standard (SEP-1865 compliant hosts)
 * - standalone: Inspector, development, testing mode
 *
 * Usage:
 * ```typescript
 * import { createHostAdaptor, detectHostType } from 'mcp-use/react';
 *
 * const hostType = detectHostType();
 * const adaptor = createHostAdaptor();
 *
 * // Use unified API regardless of host
 * await adaptor.callTool('my-tool', { arg: 'value' });
 * ```
 */

import type { WidgetHostAdaptor, HostType } from "./types.js";
import { AppsSdkAdaptor } from "./apps-sdk-adaptor.js";
import { McpAppAdaptor } from "./mcp-app-adaptor.js";
import { StandaloneAdaptor } from "./standalone-adaptor.js";

// Re-export types
export type { WidgetHostAdaptor, HostType, McpUseGlobals } from "./types.js";

// Re-export adaptors for advanced use cases
export { AppsSdkAdaptor } from "./apps-sdk-adaptor.js";
export { McpAppAdaptor } from "./mcp-app-adaptor.js";
export { StandaloneAdaptor } from "./standalone-adaptor.js";

/**
 * Detect the current host type at runtime
 *
 * Detection priority:
 * 1. Explicit override via window.mcpUse.hostType (injected by server)
 * 2. window.openai presence -> apps-sdk
 * 3. In iframe (window.parent !== window) -> mcp-app
 * 4. Default -> standalone
 *
 * @returns The detected host type
 */
export function detectHostType(): HostType {
  if (typeof window === "undefined") {
    return "standalone";
  }

  // Check for explicit override (injected by server in HTML template)
  if (window.mcpUse?.hostType) {
    return window.mcpUse.hostType;
  }

  // Check for OpenAI Apps SDK (window.openai exists)
  if (window.openai) {
    return "apps-sdk";
  }

  // Check if we're in an iframe (potential MCP App host)
  if (window.parent !== window) {
    return "mcp-app";
  }

  // Default to standalone mode
  return "standalone";
}

/**
 * Singleton adaptor instance
 * Created lazily on first use
 */
let adaptorInstance: WidgetHostAdaptor | null = null;

/**
 * Create the appropriate host adaptor for the current environment
 *
 * This function is memoized and returns the same instance on subsequent calls.
 * This ensures consistent state across multiple useWidget hook invocations.
 *
 * @returns The host adaptor instance
 */
export function createHostAdaptor(): WidgetHostAdaptor {
  if (adaptorInstance) {
    return adaptorInstance;
  }

  const hostType = detectHostType();

  switch (hostType) {
    case "apps-sdk":
      adaptorInstance = new AppsSdkAdaptor();
      break;
    case "mcp-app":
      adaptorInstance = new McpAppAdaptor();
      break;
    case "standalone":
    default:
      adaptorInstance = new StandaloneAdaptor();
      break;
  }

  return adaptorInstance;
}

/**
 * Reset the adaptor instance (for testing purposes)
 */
export function resetHostAdaptor(): void {
  adaptorInstance = null;
}

/**
 * Get the current adaptor instance without creating one
 * Returns null if no adaptor has been created yet
 */
export function getHostAdaptor(): WidgetHostAdaptor | null {
  return adaptorInstance;
}
