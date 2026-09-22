import {
  auth,
  InsufficientScopeError,
  UnauthorizedError,
  type OAuthClientProvider,
} from "@modelcontextprotocol/client";
import type { NodeOAuthAuthorizationResponse } from "./node.js";
import { runAuthPopup } from "./popup.js";

const DEFAULT_AUTH_TIMEOUT_MS = 5 * 60_000;

/** Provider extras used by the Node loopback and browser popup flows. */
type FlowProvider = OAuthClientProvider & {
  serverUrlHash?: string;
  hasPendingFlow?: boolean;
  getAuthorizationResponse?: () => Promise<NodeOAuthAuthorizationResponse>;
  getAuthorizationCode?: () => Promise<string>;
  getProxyFetch?: (baseFetch?: typeof fetch) => typeof fetch | undefined;
  getKey?: (keySuffix: string) => string;
  getLastAttemptedAuthUrl?: () => string | null;
  markFlowComplete?: () => void;
  preventAutoAuth?: boolean;
  startAuthorization?: () => void;
  useRedirectFlow?: boolean;
};

/** Host callback used to complete the official transport's pending OAuth flow. */
type FinishOAuthAuthorization = (code: string, iss?: string) => Promise<void>;

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
 * True when the official SDK has started an interactive OAuth flow that the
 * host must finish before retrying the logical MCP operation.
 */
export function isOAuthInteractionRequired(err: unknown, depth = 0): boolean {
  if (!err || depth > 5) return false;
  if (
    err instanceof InsufficientScopeError ||
    err instanceof UnauthorizedError
  ) {
    return true;
  }
  if (err instanceof Error) {
    if (
      err.name === "InsufficientScopeError" ||
      err.name === "UnauthorizedError"
    ) {
      return true;
    }
    if (err.cause && isOAuthInteractionRequired(err.cause, depth + 1)) {
      return true;
    }
    const data = (err as { data?: { cause?: unknown } }).data;
    if (data?.cause && isOAuthInteractionRequired(data.cause, depth + 1)) {
      return true;
    }
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
  options: {
    timeoutMs?: number;
    fetchFn?: typeof fetch;
    finishAuthorization?: FinishOAuthAuthorization;
  } = {}
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

  // With preventAutoAuth, redirectToAuthorization() deliberately only stores
  // the SDK-prepared URL. An explicit authenticate() call is the user gesture
  // that should launch that already-prepared request.
  if (
    flowProvider.preventAutoAuth === true &&
    typeof flowProvider.startAuthorization === "function"
  ) {
    flowProvider.startAuthorization();
  }

  if (
    typeof flowProvider.getAuthorizationResponse === "function" ||
    typeof flowProvider.getAuthorizationCode === "function"
  ) {
    const response =
      typeof flowProvider.getAuthorizationResponse === "function"
        ? await flowProvider.getAuthorizationResponse()
        : { code: await flowProvider.getAuthorizationCode!() };
    if (options.finishAuthorization) {
      await options.finishAuthorization(response.code, response.iss);
    } else {
      // Connect-time authorization may no longer have its failed transport.
      // Keep the official top-level helper as the fallback for that case.
      await auth(provider, {
        serverUrl,
        authorizationCode: response.code,
        ...(response.iss !== undefined ? { iss: response.iss } : {}),
        fetchFn,
      });
    }
    return;
  }

  const browserResult = await waitForBrowserAuthComplete(
    flowProvider,
    timeoutMs
  );
  if (browserResult?.authorizationCode) {
    if (options.finishAuthorization) {
      await options.finishAuthorization(
        browserResult.authorizationCode,
        browserResult.issuer
      );
    } else {
      await auth(provider, {
        serverUrl,
        authorizationCode: browserResult.authorizationCode,
        ...(browserResult.issuer !== undefined
          ? { iss: browserResult.issuer }
          : {}),
        fetchFn,
      });
    }
  }
}

async function waitForBrowserAuthComplete(
  provider: FlowProvider,
  timeoutMs: number
): Promise<{ authorizationCode?: string; issuer?: string } | undefined> {
  if (typeof window === "undefined") {
    throw new Error(
      "OAuth redirect requires a browser environment or a provider with getAuthorizationCode()"
    );
  }

  if (provider.useRedirectFlow) {
    // Do not return to the caller and retry the MCP connection before the
    // full-page navigation replaces this JavaScript context.
    await new Promise<void>(() => {});
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

  try {
    const result = await runAuthPopup({
      popup: null,
      state,
      tokensKey,
      timeoutMs,
    });

    switch (result.kind) {
      case "success":
        return {
          ...(result.authorizationCode
            ? { authorizationCode: result.authorizationCode }
            : {}),
          ...(result.issuer ? { issuer: result.issuer } : {}),
        };
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
  } finally {
    provider.markFlowComplete?.();
  }
}
