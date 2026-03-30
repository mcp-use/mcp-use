import type { Resource } from "@modelcontextprotocol/sdk/types.js";
import { useMemo } from "react";

interface McpUIRendererProps {
  resource: Resource;
  onUIAction?: (action: any) => void;
  className?: string;
  customProps?: Record<string, string>;
}

/**
 * Helper function to check if a resource is an MCP UI resource
 */
export function isMcpUIResource(resource: any): boolean {
  if (!resource?.mimeType) return false;

  const mimeType = resource.mimeType.toLowerCase();
  return (
    mimeType === "text/html" ||
    mimeType === "text/html;profile=mcp-app" ||
    mimeType === "text/html+skybridge" ||
    mimeType === "text/uri-list" ||
    mimeType.startsWith("application/vnd.mcp-ui.remote-dom")
  );
}

/**
 * Component to render MCP UI resources via a sandboxed iframe.
 * Legacy remote-dom content types are no longer rendered interactively
 * (upstream @mcp-ui/client v7 dropped remote-dom support).
 */
export function McpUIRenderer({ resource, className }: McpUIRendererProps) {
  const r = resource as Resource & { text?: string; blob?: string };

  const html = useMemo(() => {
    if (r.text) return r.text;
    if (r.blob) {
      try {
        return atob(r.blob);
      } catch {
        return null;
      }
    }
    return null;
  }, [r.text, r.blob]);

  if (!html) return null;

  return (
    <div className={className}>
      <iframe
        srcDoc={html}
        sandbox="allow-scripts allow-forms allow-popups"
        title={resource.uri ?? "MCP UI Resource"}
        style={{
          width: "100%",
          minHeight: "200px",
          border: "none",
        }}
      />
    </div>
  );
}
