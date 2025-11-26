import React from "react";

/**
 * Image component that automatically handles absolute paths using the MCP public URL.
 *
 * If the src starts with /, it will be prefixed with the MCP public URL (e.g. http://localhost:3000/mcp-use/public).
 * If the src is already absolute (starts with http or data:), it will be used as is.
 *
 * @param props Standard img props
 */
export const Image: React.FC<
  React.ImgHTMLAttributes<globalThis.HTMLImageElement>
> = ({ src, ...props }) => {
  // Get the public URL from the window global injected by the MCP server
  const publicUrl =
    typeof window !== "undefined" && (window as any).__mcpPublicUrl
      ? (window as any).__mcpPublicUrl
      : "";

  // Helper to resolve the source
  const getFinalSrc = (source?: string) => {
    if (!source) return source;

    // If src is absolute or data URI, leave it alone
    if (
      source.startsWith("http://") ||
      source.startsWith("https://") ||
      source.startsWith("data:")
    ) {
      return source;
    }

    // If publicUrl is not available, return source as is (fallback)
    if (!publicUrl) {
      return source;
    }

    // Remove leading slash if present to avoid double slash when joining
    const cleanSrc = source.startsWith("/") ? source.slice(1) : source;

    // Construct the final URL
    // publicUrl is expected to not have a trailing slash based on McpServer implementation
    return `${publicUrl}/${cleanSrc}`;
  };

  const finalSrc = getFinalSrc(src);

  return <img src={finalSrc} {...props} />;
};
