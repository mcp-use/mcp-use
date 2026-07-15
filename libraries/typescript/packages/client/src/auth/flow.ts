import {
  auth,
  UnauthorizedError,
  type OAuthClientProvider,
} from "@modelcontextprotocol/client";
import { runAuthPopup } from "./popup.js";

const DEFAULT_AUTH_TIMEOUT_MS = 5 * 60_000;

/** Provider extras used by the Node loopback and browser popup flows. */
type FlowProvider = OAuthClientProvider & {
  serverUrlHash?: string;
  hasPendingFlow?: boolean;
  getAuthorizationCode?: () => Promise<string>;
  getProxyFetch?: (baseFetch?: typeof fetch) => typeof fetch | undefined;
  getKey?: (keySuffix: string) => string;
  getLastAttemptedAuthUrl?: () => string | null;
  useRedirectFlow?: boolean;
};

/**
 * True if the error (or a wrapped cause) is an HTTP 401 / UnauthorizedError
 * that should trigger the OAuth completion dance.
 */
export function isUnauthorized(err: unknown, depth = 0): boolean {
  if (!err || depth > 5) return false;
  if (err instanceof UnauthorizedError) return true;
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    if (code === 401) return true;
    if (err.name === "UnauthorizedError") return true;
    const message = err.message ?? "";
    if (message.includes("401") || message.includes("Unauthorized")) {
      return true;
    }
    if (err.cause && isUnauthorized(err.cause, depth + 1)) return true;
    const data = (err as { data?: { cause?: unknown } }).data;
    if (data?.cause && isUnauthorized(data.cause, depth + 1)) return true;
  }
  return false;
}

/**
 * Complete an in-progress or required OAuth authorization for `provider`.
 *
 * - Node loopback providers expose `getAuthorizationCode()`; we await the
 *   code and finish the token exchange.
 * - Browser providers open a popup/redirect; we wait for the callback page
 *   (`onMcpAuthorization`) to exchange the code and signal success over
 *   `BroadcastChannel` / `postMessage`.
 *
 * Safe to call when the SDK transport already invoked `auth()` on a 401
 * (Node: `hasPendingFlow`; we skip a duplicate `auth()` in that case).
 */
export async function completeOAuthFlow(
  provider: OAuthClientProvider,
  serverUrl: string,
  options: { timeoutMs?: number; fetchFn?: typeof fetch } = {}
): Promise<void> {
  const flowProvider = provider as FlowProvider;
  const timeoutMs = options.timeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS;
  const fetchFn =
    options.fetchFn ?? flowProvider.getProxyFetch?.() ?? undefined;

  if (!flowProvider.hasPendingFlow) {
    const result = await auth(provider, { serverUrl, fetchFn });
    if (result === "AUTHORIZED") return;
    if (result !== "REDIRECT") {
      throw new Error(`Unexpected OAuth auth() result: ${result}`);
    }
  }

  if (typeof flowProvider.getAuthorizationCode === "function") {
    const code = await flowProvider.getAuthorizationCode();
    await auth(provider, {
      serverUrl,
      authorizationCode: code,
      fetchFn,
    });
    return;
  }

  await waitForBrowserAuthComplete(flowProvider, timeoutMs);
}

async function waitForBrowserAuthComplete(
  provider: FlowProvider,
  timeoutMs: number
): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error(
      "OAuth redirect requires a browser environment or a provider with getAuthorizationCode()"
    );
  }

  if (provider.useRedirectFlow) {
    // Full-page redirect navigates away; nothing to await in-page.
    return;
  }

  const tokensKey = provider.getKey?.("tokens");
  if (!tokensKey) {
    throw new Error(
      "Browser OAuth provider must expose getKey() for token storage"
    );
  }

  let state: string | null = null;
  const authUrl = provider.getLastAttemptedAuthUrl?.();
  if (authUrl) {
    try {
      state = new URL(authUrl).searchParams.get("state");
    } catch {
      // state-less fallback is supported by runAuthPopup
    }
  }

  const result = await runAuthPopup({
    popup: null,
    state,
    tokensKey,
    timeoutMs,
  });

  switch (result.kind) {
    case "success":
      return;
    case "cancelled":
      throw new Error("OAuth authentication was cancelled.");
    case "timeout":
      throw new Error(
        `OAuth callback not received within ${timeoutMs}ms. Ensure /oauth/callback calls onMcpAuthorization().`
      );
    case "error":
      throw new Error(result.error);
    default:
      throw new Error("Unexpected OAuth popup result");
  }
}
