/**
 * TypeScript declarations for the WebMCP browser API (navigator.modelContext).
 * WebMCP is a proposed web standard (Chrome 146+) that exposes structured tools
 * for in-browser AI agents.
 *
 * @see https://developer.chrome.com/docs/webmcp
 */

/**
 * Content item returned by a WebMCP tool's execute function.
 */
export interface WebMCPContentItem {
  type: "text";
  text: string;
}

/**
 * Result returned by a WebMCP tool's execute function.
 */
export interface WebMCPExecuteResult {
  content: WebMCPContentItem[];
}

/**
 * Annotations for a WebMCP tool (hints for the agent).
 */
export interface WebMCPToolAnnotations {
  /** If "true", the tool does not modify its environment. */
  readOnlyHint?: string;
}

/**
 * Definition of a single tool for the WebMCP API.
 * Maps closely to MCP's Tool type (name, description, inputSchema).
 */
export interface WebMCPToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
  annotations?: WebMCPToolAnnotations;
  execute: (
    args: Record<string, unknown>
  ) => Promise<WebMCPExecuteResult> | WebMCPExecuteResult;
}

/**
 * Options for provideContext() - replaces the entire set of registered tools.
 */
export interface WebMCPProvideContextOptions {
  tools: WebMCPToolDefinition[];
}

/**
 * The Model Context Protocol API exposed on navigator in supporting browsers.
 * navigator.modelContext is declared elsewhere (e.g. client/model-context.ts) as
 * unknown; cast to ModelContext when calling these methods.
 */
export interface ModelContext {
  /**
   * Register a single tool. Does not remove other registered tools.
   */
  registerTool(tool: WebMCPToolDefinition): void;

  /**
   * Remove a specific tool by name.
   */
  unregisterTool(name: string): void;

  /**
   * Replace the entire set of registered tools with the given list.
   */
  provideContext(options: WebMCPProvideContextOptions): void;

  /**
   * Remove all registered tools.
   */
  clearContext(): void;
}
