import { BlurFade } from "@/client/components/ui/blur-fade";
import { RandomGradientBackground } from "@/client/components/ui/random-gradient-background";
import { Spinner } from "@/client/components/ui/spinner";
import { cn } from "@/client/lib/utils";
import { getServerDisplayName } from "@/client/utils/servers";
import type { UseMcpResult } from "@mcp-use/client/react";
import { useState } from "react";

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
  const [imageResult, setImageResult] = useState<{
    url: string;
    status: "loaded" | "error";
  } | null>(null);

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

  // Track the result by URL rather than resetting it in an effect. Data URLs can
  // finish loading before effects run, so an effect-based reset can overwrite
  // the onLoad result and leave the spinner visible forever.
  const imageLoading = iconUrl !== null && imageResult?.url !== iconUrl;
  const imageError =
    iconUrl !== null &&
    imageResult?.url === iconUrl &&
    imageResult.status === "error";

  // Get server display name
  const displayName = getServerDisplayName(server);

  // If no icon available, show gradient with initials
  if (!iconUrl || imageError) {
    return (
      <BlurFade delay={0.05} offset={0}>
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
    <BlurFade delay={0.05} offset={0}>
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
          onLoad={() => setImageResult({ url: iconUrl, status: "loaded" })}
          onError={() => setImageResult({ url: iconUrl, status: "error" })}
          style={{
            imageRendering: "-webkit-optimize-contrast",
            display: imageLoading ? "none" : "block",
          }}
        />
      </div>
    </BlurFade>
  );
}
