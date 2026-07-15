import {
  auth,
  UnauthorizedError,
  type OAuthClientProvider,
} from "@modelcontextprotocol/client";
import {
  MCP_AUTH_BROADCAST_CHANNEL,
  MCP_AUTH_CALLBACK_MESSAGE_TYPE,
  type McpAuthCallbackMessage,
} from "./popup.js";

const DEFAULT_AUTH_TIMEOUT_MS = 5 * 60_000;

/** Provider extras used by the Node loopback and browser popup flows. */
type FlowProvider = OAuthClientProvider & {
  serverUrlHash?: string;
  hasPendingFlow?: boolean;
  getAuthorizationCode?: () => Promise<string>;
  getProxyFetch?: (baseFetch?: typeof fetch) => typeof fetch | undefined;
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

  await waitForBrowserAuthCallback(flowProvider, timeoutMs);
}

function waitForBrowserAuthCallback(
  provider: FlowProvider,
  timeoutMs: number
): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(
      new Error(
        "OAuth redirect requires a browser environment or a provider with getAuthorizationCode()"
      )
    );
  }

  const expectedHash = provider.serverUrlHash;

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let broadcast: BroadcastChannel | null = null;

    const cleanup = () => {
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      try {
        broadcast?.close();
      } catch {
        // ignore
      }
    };

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const handlePayload = (data: unknown) => {
      if (!data || typeof data !== "object") return;
      const payload = data as McpAuthCallbackMessage;
      if (payload.type !== MCP_AUTH_CALLBACK_MESSAGE_TYPE) return;
      if (
        expectedHash &&
        payload.serverUrlHash &&
        payload.serverUrlHash !== expectedHash
      ) {
        return;
      }
      if (payload.success) {
        settle(() => resolve());
        return;
      }
      settle(() =>
        reject(
          new Error(payload.error ?? "OAuth authentication failed in callback")
        )
      );
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      handlePayload(event.data);
    };

    window.addEventListener("message", onMessage);

    if (typeof BroadcastChannel !== "undefined") {
      try {
        broadcast = new BroadcastChannel(MCP_AUTH_BROADCAST_CHANNEL);
        broadcast.onmessage = (event) => handlePayload(event.data);
      } catch {
        // postMessage-only fallback
      }
    }

    const timer = window.setTimeout(() => {
      settle(() =>
        reject(
          new Error(
            `OAuth callback not received within ${timeoutMs}ms. Ensure /oauth/callback calls onMcpAuthorization().`
          )
        )
      );
    }, timeoutMs);
  });
}
