// ============================================================================
// Runtime Environment Detection
// ============================================================================

/**
 * Detected runtime environment types
 */
export type RuntimeEnvironment =
  | "node"
  | "browser"
  | "cloudflare-workers"
  | "edge"
  | "deno"
  | "bun"
  | "unknown";

/**
 * Storage capabilities for user ID persistence
 */
export type StorageCapability = "filesystem" | "localStorage" | "session-only";

/**
 * Detect the current runtime environment
 */
function detectRuntimeEnvironment(): RuntimeEnvironment {
  try {
    // Check for Bun
    if (typeof (globalThis as any).Bun !== "undefined") {
      return "bun";
    }

    // Check for Deno
    if (typeof (globalThis as any).Deno !== "undefined") {
      return "deno";
    }

    // Check for Cloudflare Workers
    if (
      typeof navigator !== "undefined" &&
      navigator.userAgent?.includes("Cloudflare-Workers")
    ) {
      return "cloudflare-workers";
    }

    // Check for Edge runtime (Vercel Edge, etc.)
    if (typeof (globalThis as any).EdgeRuntime !== "undefined") {
      return "edge";
    }

    // Check for browser FIRST (before Node.js check)
    // In browser, window and document are defined
    if (typeof window !== "undefined" && typeof document !== "undefined") {
      return "browser";
    }

    // Check for Node.js
    if (
      typeof process !== "undefined" &&
      typeof process.versions?.node !== "undefined"
    ) {
      return "node";
    }

    return "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Determine storage capability based on runtime environment
 */
export function getStorageCapability(
  env: RuntimeEnvironment
): StorageCapability {
  switch (env) {
    case "node":
    case "bun":
      return "filesystem";
    case "browser":
      // Check if localStorage is actually available (might be disabled)
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem("__mcp_use_test__", "1");
          localStorage.removeItem("__mcp_use_test__");
          return "localStorage";
        }
      } catch {
        // localStorage might be disabled (private browsing, etc.)
      }
      return "session-only";
    case "deno":
      // Deno has file system access but needs permissions
      // For now, treat as session-only to be safe
      return "session-only";
    default:
      return "session-only";
  }
}

// Cache the detected environment
let cachedEnvironment: RuntimeEnvironment | null = null;

export function getRuntimeEnvironment(): RuntimeEnvironment {
  if (cachedEnvironment === null) {
    cachedEnvironment = detectRuntimeEnvironment();
  }
  return cachedEnvironment;
}

/**
 * Check if we're in a browser environment
 */
export function isBrowserEnvironment(): boolean {
  return getRuntimeEnvironment() === "browser";
}
