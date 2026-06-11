// popup-runner.ts
//
// Opener-owned OAuth popup runner. Models the pattern used by mature browser
// OAuth libraries (auth0-spa-js `runPopup`, oidc-client-ts `AbstractChildWindow`,
// msal-browser popup clients): the window that OPENED the popup owns a promise
// that settles on exactly one of four terminal outcomes, so the caller can never
// be left waiting forever.
//
// A flow settles on the first of:
//   1. An `mcp_auth_callback` result message (postMessage from the popup's
//      `window.opener`, or a same-origin `BroadcastChannel` when the opener was
//      severed by COOP / cross-origin redirects / tab grouping), matched to this
//      flow by its OAuth `state` parameter.
//   2. The popup being closed (`popup.closed` poll). Before declaring the flow
//      cancelled we check whether tokens already landed in storage — the popup
//      may have completed the exchange and closed before its message dispatched.
//   3. A `storage` event for this flow's tokens key. This is the most robust
//      signal: the popup always persists tokens to localStorage before notifying,
//      and `storage` events fire cross-window even when message channels are
//      severed or partitioned (the MSAL "redirect bridge partition" gotcha).
//   4. A timeout. Same tokens check as the close path before declaring timeout.

/** Channel name shared by the popup callback notifier and every listener. */
export const MCP_AUTH_BROADCAST_CHANNEL = "mcp_auth_callback";

/** Result message type posted by the OAuth callback page. */
export const MCP_AUTH_CALLBACK_MESSAGE_TYPE = "mcp_auth_callback";

/**
 * Payload shape posted by the OAuth callback page over `postMessage` /
 * `BroadcastChannel`. `state` and `serverUrlHash` are used to scope a result
 * to the flow / server that initiated it; both are optional for backward
 * compatibility with callback pages built against older versions.
 */
export interface McpAuthCallbackMessage {
  type?: string;
  success?: boolean;
  error?: string;
  /** OAuth `state` parameter of the originating authorization request. */
  state?: string;
  /** Hash of the server URL the flow authenticated against. */
  serverUrlHash?: string;
}

/** Terminal outcome of an opener-owned popup flow. */
export type AuthPopupResult =
  | { kind: "success" }
  | { kind: "error"; error: string }
  | { kind: "cancelled" }
  | { kind: "timeout" };

export interface RunAuthPopupOptions {
  /**
   * The popup window handle returned by `window.open`. May be `null` when the
   * popup was blocked or opened out-of-band (e.g. a manual fallback link); the
   * runner then relies on the message / storage / timeout signals only.
   */
  popup: globalThis.Window | null;
  /** OAuth `state` parameter for this flow. Used to ignore unrelated results. */
  state: string | null;
  /** localStorage key under which the flow's tokens are persisted on success. */
  tokensKey: string;
  /** Overall flow timeout. Default 5 minutes. */
  timeoutMs?: number;
  /** Interval for the `popup.closed` poll. Default 1s (matches auth0-spa-js). */
  closePollMs?: number;
  /**
   * How long to keep waiting for a result after the popup reports closed
   * without tokens, before settling `cancelled`. COOP browsing-context-group
   * swaps (popup navigating cross-origin) make `popup.closed` report `true`
   * while the real window is still open mid-flow, so a closed signal is only
   * a soft hint — message/storage listeners stay alive during this grace
   * window and can still settle `success`. Default 20s.
   */
  closeGraceMs?: number;
  /**
   * Origin to accept `postMessage` results from. Defaults to the current
   * window origin. BroadcastChannel results are same-origin by definition.
   */
  expectedOrigin?: string;
}

function hasStoredTokens(tokensKey: string): boolean {
  try {
    return (
      typeof localStorage !== "undefined" && !!localStorage.getItem(tokensKey)
    );
  } catch {
    return false;
  }
}

/**
 * Run an opener-owned OAuth popup flow and resolve once it reaches a terminal
 * outcome. Never rejects — all failure modes map to an {@link AuthPopupResult}.
 */
export function runAuthPopup({
  popup,
  state,
  tokensKey,
  timeoutMs = 5 * 60_000,
  closePollMs = 1000,
  closeGraceMs = 20_000,
  expectedOrigin = typeof window !== "undefined" ? window.location.origin : "",
}: RunAuthPopupOptions): Promise<AuthPopupResult> {
  return new Promise<AuthPopupResult>((resolve) => {
    let settled = false;
    let closeTimer: ReturnType<typeof setInterval> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    let broadcastChannel: BroadcastChannel | null = null;

    const cleanup = () => {
      if (closeTimer) {
        clearInterval(closeTimer);
        closeTimer = null;
      }
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      if (graceTimer) {
        clearTimeout(graceTimer);
        graceTimer = null;
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("message", messageHandler);
        window.removeEventListener("storage", storageHandler);
      }
      if (broadcastChannel) {
        try {
          broadcastChannel.removeEventListener("message", broadcastHandler);
          broadcastChannel.close();
        } catch {
          /* ignore */
        }
        broadcastChannel = null;
      }
    };

    const settle = (result: AuthPopupResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    // Shared handler for postMessage + BroadcastChannel result payloads.
    const handlePayload = (payload: McpAuthCallbackMessage | undefined) => {
      if (!payload || payload.type !== MCP_AUTH_CALLBACK_MESSAGE_TYPE) return;
      // State-keyed: ignore results from a different concurrent flow. Payloads
      // without a `state` (older callback pages) are accepted for back-compat.
      if (payload.state && state && payload.state !== state) return;
      if (payload.success) {
        settle({ kind: "success" });
      } else {
        settle({
          kind: "error",
          error: payload.error ?? "Authentication failed in callback.",
        });
      }
    };

    const messageHandler = (event: globalThis.MessageEvent) => {
      if (expectedOrigin && event.origin !== expectedOrigin) return;
      handlePayload(event.data as McpAuthCallbackMessage | undefined);
    };

    const broadcastHandler = (event: globalThis.MessageEvent) => {
      handlePayload(event.data as McpAuthCallbackMessage | undefined);
    };

    const storageHandler = (event: globalThis.StorageEvent) => {
      if (event.key !== tokensKey) return;
      // A non-null new value means the popup just persisted fresh tokens.
      if (event.newValue) settle({ kind: "success" });
    };

    if (typeof window !== "undefined") {
      window.addEventListener("message", messageHandler);
      window.addEventListener("storage", storageHandler);
    }

    if (typeof BroadcastChannel !== "undefined") {
      try {
        broadcastChannel = new BroadcastChannel(MCP_AUTH_BROADCAST_CHANNEL);
        broadcastChannel.addEventListener("message", broadcastHandler);
      } catch {
        broadcastChannel = null;
      }
    }

    // Poll for popup closure. The user may close it without completing, or it
    // may complete and close before its result message is delivered.
    if (popup) {
      closeTimer = setInterval(() => {
        if (settled) return;
        let closed = false;
        try {
          closed = popup.closed;
        } catch {
          // Cross-origin access to `.closed` can throw under some engines;
          // treat as not-closed and keep waiting for other signals.
          closed = false;
        }
        if (!closed) return;
        if (closeTimer) {
          clearInterval(closeTimer);
          closeTimer = null;
        }
        if (hasStoredTokens(tokensKey)) {
          settle({ kind: "success" });
          return;
        }
        // Soft-close grace window: `popup.closed` is unreliable under COOP —
        // a cross-origin navigation swaps the browsing context group and the
        // original WindowProxy reports closed while the real window is still
        // open mid-consent (observed in the field: closed at ~3s, tokens
        // landing ~7s later). Keep the message/storage listeners alive and
        // only settle `cancelled` if nothing arrives within the grace window.
        graceTimer = setTimeout(() => {
          settle(
            hasStoredTokens(tokensKey)
              ? { kind: "success" }
              : { kind: "cancelled" }
          );
        }, closeGraceMs);
      }, closePollMs);
    }

    timeoutTimer = setTimeout(() => {
      settle(
        hasStoredTokens(tokensKey) ? { kind: "success" } : { kind: "timeout" }
      );
    }, timeoutMs);
  });
}
