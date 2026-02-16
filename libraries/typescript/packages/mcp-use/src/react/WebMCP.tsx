import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import React, { type ReactNode } from "react";
import type { UseMcpOptions } from "./types.js";
import { useWebMCP } from "./useWebMCP.js";

export interface WebMCPProps extends UseMcpOptions {
  /** Filter which tools to expose to WebMCP. Return true to include. */
  filter?: (tool: Tool) => boolean;
  /** Prefix to add to tool names to avoid collisions with other WebMCP tools on the page. */
  prefix?: string;
  /** Called whenever Chrome's agent invokes a tool. */
  onToolCall?: (
    toolName: string,
    args: Record<string, unknown>,
    result: unknown
  ) => void;
  /** Called when tools are registered/updated in WebMCP. */
  onRegistered?: (tools: Tool[]) => void;
  /** Optional children. The component renders children as-is; it does not render anything by default. */
  children?: ReactNode;
}

/**
 * React component that connects to an MCP server and registers its tools
 * with the WebMCP browser API (navigator.modelContext) so in-browser AI
 * agents (e.g. Chrome's agentic features) can discover and invoke them.
 *
 * When WebMCP is not supported (e.g. non-Chrome or flag disabled), the
 * component still connects to the MCP server but does not register with
 * WebMCP. No UI is rendered unless `children` is provided.
 *
 * @example
 * ```tsx
 * <WebMCP url="https://my-mcp-server.com/mcp" />
 * ```
 *
 * @example
 * ```tsx
 * <WebMCP url="https://api.example.com/mcp" filter={(t) => t.name.startsWith('public_')}>
 *   <div>Tools are exposed to the browser agent.</div>
 * </WebMCP>
 * ```
 */
export function WebMCP({
  filter,
  prefix,
  onToolCall,
  onRegistered,
  children,
  ...useMcpOptions
}: WebMCPProps): React.ReactElement | null {
  useWebMCP({
    ...useMcpOptions,
    filter,
    prefix,
    onToolCall,
    onRegistered,
  });

  if (children !== undefined && children !== null) {
    return <>{children}</>;
  }
  return null;
}
