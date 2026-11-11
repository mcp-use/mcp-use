import { useSyncExternalStore } from "react";

import { useViewRuntime } from "../runtime/view-runtime-context.js";

/** Incoming deep-link state for the current MCP App view. */
export interface DeepLinkHandle {
  /**
   * Host-provided app-relative URL, including any query string.
   * `undefined` when the host has supplied no deep link.
   */
  url: string | undefined;
}

function readDeepLinkUrl(link: unknown): string | undefined {
  if (typeof link !== "object" || link === null || Array.isArray(link)) {
    return undefined;
  }
  const state = link as Record<string, unknown>;
  if (typeof state.url === "string") return state.url;

  // Match the official getter's compatibility with older host payloads.
  const { path, query } = state;
  if (
    !Array.isArray(path) ||
    !path.every((segment) => typeof segment === "string") ||
    !Array.isArray(query) ||
    !query.every(
      (pair) =>
        Array.isArray(pair) &&
        pair.length === 2 &&
        pair.every((part) => typeof part === "string")
    )
  ) {
    return undefined;
  }
  const search = new URLSearchParams(query as [string, string][]).toString();
  return `/${path.map(encodeURIComponent).join("/")}${search ? `?${search}` : ""}`;
}

/**
 * Read the incoming ChatGPT deep link through the view's existing connection.
 *
 * Reads the initial `openai/deepLink` host context after initialization and
 * updates when the host sends a new URL. Returns `undefined` before the host
 * supplies a link or when the host does not support deep links. Route parsing,
 * authorization, and local navigation remain the application's responsibility.
 * Older host `path` / `query` payloads are normalized to the same URL shape.
 *
 * The subscription is cleaned up when the component unmounts. This hook does
 * not create another connection or send local navigation back to the host.
 *
 * @returns The latest incoming app-relative URL.
 *
 * @example
 * ```tsx
 * function Browser() {
 *   const { url } = useDeepLink();
 *   return <Route path={url ?? "/"} />;
 * }
 * ```
 */
export function useDeepLink(): DeepLinkHandle {
  const runtime = useViewRuntime();
  const url = useSyncExternalStore(runtime.subscribeHost, () => {
    return readDeepLinkUrl(
      runtime.getHostSnapshot().hostContext?.["openai/deepLink"]
    );
  });
  return { url };
}
