/**
 * React hook that bridges an MCP server's tools to the WebMCP browser API
 * (navigator.modelContext). When the MCP connection is ready, tools are
 * registered with WebMCP so in-browser AI agents (e.g. Chrome's agent) can
 * discover and invoke them.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { useCallback, useEffect, useRef } from "react";
import type { UseMcpOptions, UseMcpResult } from "./types.js";
import { useMcp } from "./useMcp.js";
import type {
  ModelContext,
  WebMCPExecuteResult,
  WebMCPToolAnnotations,
  WebMCPToolDefinition,
} from "./webmcp-types.js";

/** MCP callTool result shape: may have content array or be serialized elsewhere */
interface MCPToolResult {
  content?: Array<{ type: string; text?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

/**
 * Convert MCP tool result to WebMCP content format.
 */
function mcpResultToWebMCPContent(
  result: MCPToolResult
): WebMCPExecuteResult["content"] {
  if (result.content && Array.isArray(result.content)) {
    return result.content
      .filter(
        (item): item is { type: "text"; text: string } =>
          item.type === "text" && typeof item.text === "string"
      )
      .map((item) => ({ type: "text" as const, text: item.text }));
  }
  const text =
    typeof result === "string" ? result : JSON.stringify(result, null, 2);
  return [{ type: "text", text }];
}

/**
 * Map a single MCP Tool to a WebMCP tool definition (with execute that proxies to callTool).
 */
function mcpToolToWebMCPDefinition(
  tool: Tool,
  callTool: UseMcpResult["callTool"],
  prefix: string,
  onToolCall?: (
    toolName: string,
    args: Record<string, unknown>,
    result: unknown
  ) => void
): WebMCPToolDefinition {
  const name = prefix ? `${prefix}${tool.name}` : tool.name;
  const annotations: WebMCPToolAnnotations | undefined = tool.annotations
    ? {
        ...(tool.annotations.readOnlyHint !== undefined && {
          readOnlyHint: String(tool.annotations.readOnlyHint),
        }),
      }
    : undefined;

  return {
    name,
    description: tool.description ?? "",
    inputSchema: {
      type: "object",
      ...(tool.inputSchema.properties && {
        properties: tool.inputSchema.properties,
      }),
      ...(tool.inputSchema.required && { required: tool.inputSchema.required }),
      ...(typeof tool.inputSchema === "object" &&
        Object.keys(tool.inputSchema).length > 0 && {
          ...tool.inputSchema,
        }),
    },
    ...(annotations && Object.keys(annotations).length > 0 && { annotations }),
    execute: async (args: Record<string, unknown>) => {
      try {
        const result = await callTool(tool.name, args);
        const content = mcpResultToWebMCPContent(result as MCPToolResult);
        onToolCall?.(tool.name, args, result);
        return { content };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        onToolCall?.(tool.name, args, err);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
        };
      }
    },
  };
}

export interface UseWebMCPOptions extends UseMcpOptions {
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
}

export interface UseWebMCPResult extends UseMcpResult {
  /** True if navigator.modelContext is available in this browser. */
  isWebMCPSupported: boolean;
  /** True when tools have been successfully registered with WebMCP. */
  webMCPRegistered: boolean;
}

const WEBMCP_UNAVAILABLE_WARN =
  "[WebMCP] navigator.modelContext is not available. Use Chrome 146+ with the WebMCP flag enabled (chrome://flags/#enable-webmcp-testing).";

/**
 * Hook that connects to an MCP server via useMcp and registers its tools
 * with the WebMCP browser API when the connection is ready.
 *
 * @param options - Same as useMcpOptions plus filter, prefix, onToolCall, onRegistered
 * @returns useMcp result plus isWebMCPSupported and webMCPRegistered
 */
export function useWebMCP(options: UseWebMCPOptions): UseWebMCPResult {
  const {
    filter,
    prefix = "",
    onToolCall,
    onRegistered,
    ...useMcpOptions
  } = options;

  const mcp = useMcp(useMcpOptions);
  const isWebMCPSupported =
    typeof navigator !== "undefined" &&
    "modelContext" in navigator &&
    !!(navigator as { modelContext?: ModelContext }).modelContext;
  const onRegisteredRef = useRef(onRegistered);
  const lastRegisteredToolsRef = useRef<string>("");

  onRegisteredRef.current = onRegistered;

  const registerTools = useCallback(() => {
    const modelContext = (navigator as { modelContext?: ModelContext })
      .modelContext;
    if (!isWebMCPSupported || !modelContext) return;
    if (mcp.state !== "ready" || mcp.tools.length === 0) return;

    let toolsToRegister = mcp.tools;
    if (filter) {
      toolsToRegister = toolsToRegister.filter(filter);
    }

    if (toolsToRegister.length === 0) {
      modelContext.clearContext();
      return;
    }

    const definitions: WebMCPToolDefinition[] = toolsToRegister.map((tool) =>
      mcpToolToWebMCPDefinition(tool, mcp.callTool, prefix, onToolCall)
    );

    modelContext.provideContext({ tools: definitions });
    const key = toolsToRegister.map((t) => t.name).join(",");
    if (key !== lastRegisteredToolsRef.current) {
      lastRegisteredToolsRef.current = key;
      onRegisteredRef.current?.(toolsToRegister);
    }
  }, [
    isWebMCPSupported,
    mcp.state,
    mcp.tools,
    mcp.callTool,
    filter,
    prefix,
    onToolCall,
  ]);

  useEffect(() => {
    if (!isWebMCPSupported) {
      if (typeof console !== "undefined" && console.warn) {
        console.warn(WEBMCP_UNAVAILABLE_WARN);
      }
      return;
    }

    if (mcp.state === "ready" && mcp.tools.length > 0) {
      registerTools();
    }

    return () => {
      const modelContext = (navigator as { modelContext?: ModelContext })
        .modelContext;
      if (modelContext) {
        modelContext.clearContext();
      }
      lastRegisteredToolsRef.current = "";
    };
  }, [isWebMCPSupported, mcp.state, mcp.tools, registerTools]);

  return {
    ...mcp,
    isWebMCPSupported,
    webMCPRegistered:
      isWebMCPSupported && mcp.state === "ready" && mcp.tools.length > 0,
  };
}
