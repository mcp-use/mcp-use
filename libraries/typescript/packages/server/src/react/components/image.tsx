import React from "react";

import { publicAsset } from "../public-assets.js";

/**
 * Image element that resolves root-relative `src` paths against the project's
 * `public/` directory via the request-scoped config injected into the
 * synthesized view document.
 *
 * Root-relative paths (starting with `/`) resolve to absolute URLs under
 * `${basePath}/_mcp-use/public/`. Absolute `http(s):` and `data:` URLs pass
 * through unchanged. Fully-relative paths are left as-is.
 */
export const Image: React.FC<
  React.ImgHTMLAttributes<HTMLImageElement>
> = ({ src, ...props }) => {
  const finalSrc =
    typeof src === "string" ? publicAsset(src) : src;

  return <img src={finalSrc} {...props} />;
};
