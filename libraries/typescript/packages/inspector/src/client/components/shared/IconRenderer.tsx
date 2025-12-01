import { useState } from "react";
import { ImageIcon } from "lucide-react";
import { cn } from "@/client/lib/utils";

/**
 * Icon type matching SEP-973 specification
 * @see https://github.com/modelcontextprotocol/specification/blob/main/SEPs/sep-973-icons-and-website-url.md
 */
export interface Icon {
  src: string;
  mimeType?: string;
  sizes?: string;
}

interface IconRendererProps {
  icons?: Icon[];
  className?: string;
  size?: number;
  fallback?: React.ReactNode;
}

/**
 * Renders an icon from an Icon[] array, selecting the best match based on size.
 * Falls back to the first icon if no size match is found.
 */
export function IconRenderer({
  icons,
  className,
  size = 16,
  fallback,
}: IconRendererProps) {
  const [error, setError] = useState(false);

  if (!icons || icons.length === 0) {
    return fallback ? <>{fallback}</> : null;
  }

  // Select the best icon based on size
  // For now, just use the first icon. In the future, we could parse sizes
  // and select the best match (e.g., "48x48" for size 48)
  const icon = icons[0];

  // Handle data URIs
  if (icon.src.startsWith("data:")) {
    return (
      <img
        src={icon.src}
        alt=""
        className={cn("object-contain", className)}
        style={{ width: size, height: size }}
        onError={() => setError(true)}
        onLoad={() => setError(false)}
      />
    );
  }

  // Handle regular URLs
  if (error) {
    return fallback ? <>{fallback}</> : <ImageIcon className={className} style={{ width: size, height: size }} />;
  }

  return (
    <img
      src={icon.src}
      alt=""
      className={cn("object-contain", className)}
      style={{ width: size, height: size }}
      onError={() => setError(true)}
      onLoad={() => setError(false)}
    />
  );
}
