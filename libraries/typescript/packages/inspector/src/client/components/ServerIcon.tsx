import { BlurFade } from "@/client/components/ui/blur-fade";
import { RandomGradientBackground } from "@/client/components/ui/random-gradient-background";
import { Spinner } from "@/client/components/ui/spinner";
import { cn } from "@/client/lib/utils";
import { useEffect, useState } from "react";

interface ServerIconProps {
  serverUrl?: string;
  serverName?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
}

function getBaseDomain(hostname: string): string {
  const parts = hostname.split(".");
  if (parts.length <= 2) {
    return hostname;
  }
  return parts.slice(parts.length - 2).join(".");
}

interface FaviconCache {
  base64: string;
  timestamp: number;
}

const FAVICON_CACHE_KEY = "mcp-inspector-favicon-cache";
const CACHE_TTL_MS = 10 * 24 * 60 * 60 * 1000; // 10 days in milliseconds

// Helper functions for favicon cache
function getFaviconCache(): Record<string, FaviconCache> {
  try {
    const cached = localStorage.getItem(FAVICON_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (error) {
    console.error("Failed to load favicon cache:", error);
  }
  return {};
}

function setFaviconCache(domain: string, base64: string) {
  try {
    const cache = getFaviconCache();
    cache[domain] = {
      base64,
      timestamp: Date.now(),
    };
    localStorage.setItem(FAVICON_CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.error("Failed to save favicon cache:", error);
  }
}

function getCachedFavicon(domain: string): string | null {
  try {
    const cache = getFaviconCache();
    const cached = cache[domain];

    if (cached) {
      const age = Date.now() - cached.timestamp;
      if (age < CACHE_TTL_MS) {
        return cached.base64;
      } else {
        // Cache expired, remove it
        delete cache[domain];
        localStorage.setItem(FAVICON_CACHE_KEY, JSON.stringify(cache));
      }
    }
  } catch (error) {
    console.error("Failed to get cached favicon:", error);
  }
  return null;
}

async function fetchAndCacheImage(
  url: string,
  domain: string
): Promise<string> {
  const response = await fetch(url);
  const blob = await response.blob();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      setFaviconCache(domain, base64);
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function ServerIcon({
  serverUrl,
  serverName,
  className,
  size = "md",
}: ServerIconProps) {
  const [faviconUrl, setFaviconUrl] = useState<string | null>(null);
  const [faviconError, setFaviconError] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);

  const sizeClasses = {
    sm: "w-6 h-6",
    md: "w-8 h-8",
    lg: "w-12 h-12",
    xs: "w-4 h-4",
  };

  useEffect(() => {
    if (!serverUrl) return;

    const fetchFavicon = async () => {
      setIsLoading(true);
      setFaviconError(false);

      try {
        // Extract domain from serverUrl
        let domain = serverUrl;
        if (
          serverUrl.startsWith("http://") ||
          serverUrl.startsWith("https://")
        ) {
          domain = new URL(serverUrl).hostname;
        } else if (serverUrl.includes("://")) {
          domain = serverUrl.split("://")[1].split("/")[0];
        } else {
          domain = serverUrl.split("/")[0];
        }

        // Check if this is a local server - skip remote favicon services
        const isLocalServer =
          domain === "localhost" ||
          domain === "127.0.0.1" ||
          domain.startsWith("127.") ||
          domain.startsWith("192.168.") ||
          domain.startsWith("10.") ||
          domain.startsWith("172.");

        if (isLocalServer) {
          // For local servers, skip favicon fetching and go straight to fallback
          setFaviconError(true);
          setIsLoading(false);
          return;
        }

        // Check cache first
        const cachedFavicon = getCachedFavicon(domain);
        console.log("cachedFavicon", cachedFavicon);
        // if (cachedFavicon) {
        //   setFaviconUrl(cachedFavicon);
        //   setIsLoading(false);
        //   return;
        // }

        // Try full domain first, then base domain with 1s timeout
        const baseDomain = getBaseDomain(serverUrl);
        console.log("baseDomain", baseDomain);
        const domainsToTry =
          domain !== baseDomain ? [domain, baseDomain] : [domain];
        console.log("domainsToTry", domainsToTry);

        let defaultResponse = null;

        for (const currentDomain of domainsToTry) {
          try {
            const currentFaviconUrl = `https://favicon.tools.mcp-use.com/${currentDomain}`;
            console.log("currentFaviconUrl", currentFaviconUrl);

            // Create a timeout promise
            let _timeoutId: NodeJS.Timeout;
            const timeoutPromise = new Promise<never>((_, reject) => {
              _timeoutId = setTimeout(() => reject(new Error("Timeout")), 1000);
            });

            // Race between fetch and timeout
            const response = await Promise.race([
              fetch(currentFaviconUrl + "?response=json"),
              timeoutPromise,
            ]);

            const responseJson = (await response.json()) as {
              url: string;
              sourceUrl: string;
              width: number;
              height: number;
              format: string;
              bytes: number;
              source: string;
            };
            defaultResponse = responseJson;

            if (responseJson.source === "link-tag") {
              // Fetch and cache the image as base64
              const base64Image = await fetchAndCacheImage(
                responseJson.sourceUrl,
                currentDomain
              );
              setImageLoading(true);
              setFaviconUrl(base64Image);
              setIsLoading(false);
              return;
            }
          } catch {
            console.error(`Failed to fetch favicon for ${currentDomain}`);
            // Continue to next service
            continue;
          }
        }

        if (defaultResponse) {
          const base64Image = await fetchAndCacheImage(
            defaultResponse.sourceUrl,
            domain
          );
          setImageLoading(true);
          setFaviconUrl(base64Image);
          setIsLoading(false);
          return;
        }

        // If all services fail
        setFaviconError(true);
      } catch {
        setFaviconError(true);
      } finally {
        setIsLoading(false);
      }
    };

    fetchFavicon();
  }, [serverUrl]);

  // Generate a consistent color based on server name or URL
  const getServerColor = () => {
    const seed = serverName || serverUrl || "default";
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      const char = seed.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    const hue = Math.abs(hash) % 360;
    return `oklch(0.4 0.2 ${hue})`;
  };

  return (
    <div
      className={cn(
        "rounded-full overflow-hidden flex-shrink-0 relative",
        sizeClasses[size],
        className
      )}
    >
      {isLoading ? (
        <div className="w-full h-full flex items-center justify-center bg-gray-100/20 dark:bg-gray-800">
          <Spinner className="text-gray-200" />
        </div>
      ) : faviconUrl && !faviconError ? (
        <>
          {imageLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-100/20 dark:bg-gray-800 z-10">
              <Spinner className="text-gray-200" />
            </div>
          )}
          <BlurFade
            duration={0.6}
            delay={0.1}
            blur="8px"
            direction="up"
            className="w-full h-full"
          >
            <img
              src={faviconUrl}
              alt={`${serverName || "Server"} favicon`}
              className="w-full h-full object-cover"
              onLoad={() => setImageLoading(false)}
              onError={() => {
                setImageLoading(false);
                setFaviconError(true);
              }}
            />
          </BlurFade>
        </>
      ) : (
        <RandomGradientBackground
          className="w-full h-full"
          color={getServerColor()}
        >
          <div className="w-full h-full flex items-center justify-center text-white font-semibold text-xs">
            {serverName ? serverName.charAt(0).toUpperCase() : "S"}
          </div>
        </RandomGradientBackground>
      )}
    </div>
  );
}
