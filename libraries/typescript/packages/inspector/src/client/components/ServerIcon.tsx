import { BlurFade } from "@/client/components/ui/blur-fade";
import { RandomGradientBackground } from "@/client/components/ui/random-gradient-background";
import { Spinner } from "@/client/components/ui/spinner";
import { cn } from "@/client/lib/utils";
import type { UseMcpResult } from "mcp-use/react";
import { useEffect, useState } from "react";

interface ServerIconProps {
  server: UseMcpResult;
  className?: string;
  size?: "sm" | "md" | "lg" | "xs";
}

/**
 * Render a server avatar using the server's provided icon when available, falling back to a random gradient background.
 *
 * @param server - The server result containing `serverInfo` (used to select `icons[0].src`, `icon`, and `name`) and a fallback `name`.
 * @param size - Visual size variant for the avatar; one of `"xs"`, `"sm"`, `"md"`, or `"lg"`, which maps to different width/height utility classes.
 * @returns A React element that displays the server icon image (with a loading spinner overlay while the image loads) or a rounded gradient fallback if no icon is available or image loading fails.
 */
export function ServerIcon({
  server,
  className,
  size = "md",
}: ServerIconProps) {
  const [imageLoading, setImageLoading] = useState(true);
  const [imageError, setImageError] = useState(false);

  const sizeClasses = {
    sm: "w-6 h-6",
    md: "w-8 h-8",
    lg: "w-12 h-12",
    xs: "w-4 h-4",
  };

  // Determine which icon to show (priority: icons array > serverInfo.icon > gradient)
  const iconUrl = (() => {
    // 1. Check if server provided icons in serverInfo.icons array
    const serverIcons = server.serverInfo?.icons;
    if (serverIcons && Array.isArray(serverIcons) && serverIcons.length > 0) {
      return serverIcons[0].src;
    }

    // 2. Check if auto-detected icon is available
    if (server.serverInfo?.icon) {
      return server.serverInfo.icon;
    }

    // 3. No icon available - will show gradient
    return null;
  })();

  // Reset loading and error states when iconUrl changes
  useEffect(() => {
    setImageLoading(iconUrl !== null);
    setImageError(false);
  }, [iconUrl]);

  // Get server display name
  const displayName = server.serverInfo?.name || server.name || "MCP";

  // If no icon available, show gradient with initials
  if (!iconUrl || imageError) {
    return (
      <BlurFade delay={0.05}>
        <RandomGradientBackground
          className={cn(
            "flex items-center justify-center rounded-full overflow-hidden",
            sizeClasses[size],
            className
          )}
        ></RandomGradientBackground>
      </BlurFade>
    );
  }

  // Show image icon
  return (
    <BlurFade delay={0.05}>
      <div
        className={cn(
          "rounded-md overflow-hidden flex items-center justify-center bg-white dark:bg-zinc-800 relative",
          sizeClasses[size],
          className
        )}
      >
        {imageLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-100/80 dark:bg-zinc-800/80">
            <Spinner />
          </div>
        )}
        <img
          src={iconUrl}
          alt={displayName}
          className={cn("object-contain", sizeClasses[size])}
          onLoad={() => setImageLoading(false)}
          onError={() => {
            setImageLoading(false);
            setImageError(true);
          }}
          style={{
            imageRendering: "-webkit-optimize-contrast",
            display: imageLoading ? "none" : "block",
          }}
        />
      </div>
    </BlurFade>
  );
}
