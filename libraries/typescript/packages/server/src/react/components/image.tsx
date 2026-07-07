import React from "react";

declare global {
  interface Window {
    __mcpPublicAssetsUrl?: string;
    __mcpPublicUrl?: string;
  }
}

/**
 * Image element that resolves root-relative `src` paths against the MCP public
 * asset URL injected by the server at build time.
 */
export const Image: React.FC<
  React.ImgHTMLAttributes<HTMLImageElement>
> = ({ src, ...props }) => {
  const publicUrl =
    typeof window !== "undefined"
      ? (window.__mcpPublicAssetsUrl ?? window.__mcpPublicUrl ?? "")
      : "";

  const finalSrc = (() => {
    if (!src) return src;
    if (
      src.startsWith("http://") ||
      src.startsWith("https://") ||
      src.startsWith("data:")
    ) {
      return src;
    }
    if (!publicUrl) return src;
    const cleanSrc = src.startsWith("/") ? src.slice(1) : src;
    return `${publicUrl}/${cleanSrc}`;
  })();

  return <img src={finalSrc} {...props} />;
};
