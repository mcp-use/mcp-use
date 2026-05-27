// callback.ts
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { BrowserOAuthClientProvider } from "./browser-provider.js"; // Adjust path
import type { StoredState } from "./types.js"; // Adjust path, ensure definition includes providerOptions

/**
 * Module-level cache of an in-flight (or completed) `onMcpAuthorization()`
 * promise. The OAuth callback consumes a single-use authorization code and
 * removes its localStorage state record on first run. If the callback page's
 * effect runs again in the same page load (HMR, React strict-mode double
 * invocation, Suspense re-mount, etc.), the second invocation would otherwise
 * fail with "Invalid or expired state" and post a `success: false` message
 * to the opener — overwriting an already-successful auth on the parent.
 *
 * Reusing the same promise (without clearing it on settle) makes every
 * subsequent call resolve/reject with the original result without touching
 * the network or localStorage again. The popup is short-lived; on a real
 * hard refresh the module re-initializes naturally.
 */
let inFlightCallback: Promise<void> | null = null;

/**
 * Returns true when the current window was opened by our popup
 * (`window.open(authUrl, "mcp_auth_<serverUrlHash>", ...)`). `window.name`
 * survives same-origin and most cross-origin redirects, so it's a reliable
 * signal even when `window.opener` has been severed by COOP, cross-origin
 * intermediate redirects, or browser tab grouping. Used to suppress the
 * "navigate this window back to the dashboard" fallback that would otherwise
 * load the full dashboard inside the popup-sized window.
 */
function isMcpAuthPopupWindow(): boolean {
  if (typeof window === "undefined") return false;
  const name = window.name;
  return typeof name === "string" && name.startsWith("mcp_auth_");
}

/**
 * Same-origin channel used as a fallback signal when the popup can't reach
 * its opener (e.g. COOP severed `window.opener`, cross-origin intermediate
 * redirects, browser tab grouping). The parent `useMcp` subscribes to this
 * channel and reacts identically to a `postMessage` of `mcp_auth_callback`.
 *
 * Keep in sync with the `BroadcastChannel` subscription in `useMcp.ts`.
 */
export const MCP_AUTH_BROADCAST_CHANNEL = "mcp_auth_callback";

/**
 * Broadcasts an auth callback result to all same-origin browsing contexts.
 * Only used in the lost-opener fallback paths — the happy path continues to
 * use `window.opener.postMessage(...)` to avoid duplicate reconnect cycles
 * on the parent (BroadcastChannel does not deliver to the sender, but it
 * does deliver to every other same-origin tab/window).
 */
function broadcastAuthCallback(success: boolean, error?: string): void {
  if (typeof BroadcastChannel === "undefined") return;
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(MCP_AUTH_BROADCAST_CHANNEL);
    channel.postMessage(
      success
        ? { type: "mcp_auth_callback", success: true }
        : {
            type: "mcp_auth_callback",
            success: false,
            error: error ?? "Unknown error",
          }
    );
  } catch (e) {
    console.warn(
      "[mcp-callback] Failed to broadcast auth callback over BroadcastChannel:",
      e
    );
  } finally {
    // Defer close so the message has a chance to dispatch.
    if (channel) {
      setTimeout(() => {
        try {
          channel?.close();
        } catch {
          /* ignore */
        }
      }, 0);
    }
  }
}

/**
 * Render an in-place "you can close this window" UI in the current document.
 * Used in the popup-with-lost-opener fallback so we can communicate success
 * (or an OAuth error) to the user without navigating the popup window to the
 * dashboard URL.
 */
function renderCloseWindowMessage(
  title: string,
  body: string,
  tone: "success" | "error" = "success"
): void {
  if (typeof document === "undefined") return;
  try {
    document.body.innerHTML = "";
    const container = document.createElement("div");
    container.style.fontFamily = "sans-serif";
    container.style.padding = "20px";

    const heading = document.createElement("h1");
    heading.textContent = title;
    container.appendChild(heading);

    const para = document.createElement("p");
    if (tone === "error") {
      para.style.color = "red";
      para.style.backgroundColor = "#ffebeb";
      para.style.border = "1px solid red";
      para.style.padding = "10px";
      para.style.borderRadius = "4px";
    }
    para.textContent = body;
    container.appendChild(para);

    const closePara = document.createElement("p");
    closePara.textContent = "You can close this window or ";
    const closeLink = document.createElement("a");
    closeLink.href = "#";
    closeLink.textContent = "click here to close";
    closeLink.onclick = (e) => {
      e.preventDefault();
      window.close();
      return false;
    };
    closePara.appendChild(closeLink);
    closePara.appendChild(document.createTextNode("."));
    container.appendChild(closePara);

    document.body.appendChild(container);
  } catch {
    /* best-effort UI; ignore */
  }
}

/**
 * Handles the OAuth callback using the SDK's auth() function.
 * Assumes it's running on the page specified as the callbackUrl.
 *
 * Idempotent within a single page load: re-invocations return the same
 * promise as the first call (see `inFlightCallback` above).
 */
export function onMcpAuthorization(): Promise<void> {
  if (inFlightCallback) return inFlightCallback;
  inFlightCallback = doOnMcpAuthorization();
  return inFlightCallback;
}

async function doOnMcpAuthorization() {
  const queryParams = new URLSearchParams(window.location.search);
  const code = queryParams.get("code");
  const state = queryParams.get("state");
  const error = queryParams.get("error");
  const errorDescription = queryParams.get("error_description");

  const logPrefix = "[mcp-callback]"; // Generic prefix, or derive from stored state later
  console.log(`${logPrefix} Handling callback...`, {
    code,
    state,
    error,
    errorDescription,
  });

  let provider: BrowserOAuthClientProvider | null = null;
  let storedStateData: StoredState | null = null;
  let stateKey: string | null = null;

  try {
    // --- Basic Error Handling ---
    if (!state) {
      throw new Error(
        "State parameter not found or invalid in callback query parameters."
      );
    }

    // --- Find State Key ---
    // Debug: Log all localStorage keys to help diagnose state issues
    console.log(`[mcp-callback] Looking for state: ${state}`);
    console.log(
      `[mcp-callback] All localStorage keys:`,
      Object.keys(localStorage)
    );

    // Try default prefix first, then search dynamically for other prefixes
    // This handles different storageKeyPrefix values used by different servers
    const defaultStateKey = `mcp:auth:state_${state}`;
    if (localStorage.getItem(defaultStateKey)) {
      stateKey = defaultStateKey;
      console.log(
        `[mcp-callback] Found state with default key: ${defaultStateKey}`
      );
    } else {
      // Search through localStorage for keys matching the pattern *:state_${state}
      const stateKeySuffix = `:state_${state}`;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.endsWith(stateKeySuffix)) {
          stateKey = key;
          console.log(`[mcp-callback] Found state with dynamic key: ${key}`);
          break;
        }
      }
    }

    if (!stateKey) {
      // Log all state-related keys for debugging
      const stateKeys = Object.keys(localStorage).filter((k) =>
        k.includes("state")
      );
      console.log(`[mcp-callback] State keys in storage:`, stateKeys);
      throw new Error(
        `Invalid or expired state parameter "${state}". No matching state found in storage.`
      );
    }

    // --- Retrieve Stored State & Provider Options ---
    const storedStateJSON = localStorage.getItem(stateKey);
    if (!storedStateJSON) {
      throw new Error(
        `Invalid or expired state parameter "${state}". No matching state found in storage.`
      );
    }
    try {
      storedStateData = JSON.parse(storedStateJSON) as StoredState;
    } catch (e) {
      throw new Error("Failed to parse stored OAuth state.");
    }

    // Validate expiry
    if (!storedStateData.expiry || storedStateData.expiry < Date.now()) {
      localStorage.removeItem(stateKey); // Clean up expired state
      throw new Error(
        "OAuth state has expired. Please try initiating authentication again."
      );
    }

    // Handle OAuth errors after state lookup so we can use the recovered
    // storedStateData to redirect back to the originating page with error
    // params, instead of showing a raw error page.
    if (error) {
      console.log(
        `${logPrefix} OAuth error received: ${error} - ${errorDescription || "No description"}`
      );
      const isRedirectFlow = storedStateData.flowType === "redirect";
      const hasOpener = window.opener && !window.opener.closed;
      const isPopupWindow = isMcpAuthPopupWindow();

      const redirectWithError = (target: string) => {
        console.log(`${logPrefix} Returning to: ${target}`);
        localStorage.removeItem(stateKey!);
        const url = new URL(target);
        url.searchParams.set("auth_error", error);
        if (errorDescription) {
          url.searchParams.set("auth_error_description", errorDescription);
        }
        window.location.href = url.toString();
      };

      if (hasOpener) {
        window.opener.postMessage(
          {
            type: "mcp_auth_callback",
            success: false,
            error: `${error}${errorDescription ? `: ${errorDescription}` : ""}`,
          },
          window.location.origin
        );
        localStorage.removeItem(stateKey);
        window.close();
        return;
      }
      // Prefer full-page redirect back to the originating page when the
      // originating flow was a redirect flow, OR when we are clearly NOT in
      // a popup window we opened (popup-blocker / manual-link fallback).
      // For a popup whose opener was severed (COOP, cross-origin redirects,
      // tab grouping), navigating to `returnUrl?auth_error=...` would load
      // the full dashboard inside the popup window — render in place instead.
      if (storedStateData.returnUrl && (isRedirectFlow || !isPopupWindow)) {
        redirectWithError(storedStateData.returnUrl);
        return;
      }
      if (isPopupWindow) {
        broadcastAuthCallback(
          false,
          `${error}${errorDescription ? `: ${errorDescription}` : ""}`
        );
        localStorage.removeItem(stateKey);
        renderCloseWindowMessage(
          "Authentication Error",
          `${error}${errorDescription ? `: ${errorDescription}` : ""}`,
          "error"
        );
        try {
          window.close();
        } catch {
          /* close may be blocked; the user can dismiss manually */
        }
        return;
      }
      throw new Error(
        `OAuth error: ${error}${errorDescription ? ` - ${errorDescription}` : ""}`
      );
    }

    if (!code) {
      throw new Error(
        "Authorization code not found in callback query parameters."
      );
    }

    // Ensure provider options are present
    if (!storedStateData.providerOptions) {
      throw new Error("Stored state is missing required provider options.");
    }
    const { serverUrl, ...providerOptions } = storedStateData.providerOptions;
    const rawConnectionUrl = providerOptions.connectionUrl;
    const isHostedGatewayConnection = Boolean(
      rawConnectionUrl &&
      /run\.mcp-use\.com|mcp-use\.run/.test(rawConnectionUrl)
    );
    // Local inspector proxy URLs should NOT be used as connectionUrl during callback,
    // otherwise metadata resource gets rewritten to proxy and fails SDK validation.
    const callbackConnectionUrl = isHostedGatewayConnection
      ? rawConnectionUrl
      : undefined;
    // Infer OAuth proxy URL from callback URL if not stored
    // The callback URL is like: http://localhost:3000/inspector/oauth/callback
    // The OAuth proxy URL should be: http://localhost:3000/inspector/api/oauth
    // Only infer when connectionUrl is set (meaning a proxy was used for the connection).
    // When connecting directly to a CORS-enabled server (no proxy), inferring an OAuth proxy
    // would cause PRM resource mismatch since the proxy rewrites the resource field.
    let oauthProxyUrl = providerOptions.oauthProxyUrl;
    const connectionUrl = callbackConnectionUrl;
    if (!oauthProxyUrl && connectionUrl) {
      try {
        const callbackUrl = new URL(window.location.href);
        // Check if this looks like an inspector callback
        if (callbackUrl.pathname.includes("/oauth/callback")) {
          // Derive the OAuth proxy URL from the callback URL
          // e.g., /inspector/oauth/callback -> /inspector/api/oauth
          let basePath = callbackUrl.pathname.replace(
            /\/oauth\/callback.*$/,
            ""
          );

          // IMPORTANT: If the callback is at root /oauth/callback (empty basePath),
          // the OAuth proxy is likely at /inspector/api/oauth since that's where
          // the inspector package mounts its routes. This handles the case where:
          // - The hosted inspector serves the callback at /oauth/callback (via Next.js page)
          // - But the OAuth proxy is mounted at /inspector/api/oauth (via inspector package)
          if (!basePath || basePath === "") {
            const isGatewayConnection = /run\.mcp-use\.com|mcp-use\.run/.test(
              connectionUrl
            );
            if (isGatewayConnection) {
              console.log(
                `${logPrefix} Gateway connection detected; skipping default /inspector OAuth proxy inference`
              );
            } else {
              basePath = "/inspector";
              console.log(
                `${logPrefix} Callback at root /oauth/callback, using /inspector as base path for OAuth proxy`
              );
            }
          }

          // basePath is non-empty for inspector callbacks (/inspector) and empty for
          // gateway connections (the gateway-detection block above deliberately skips
          // setting basePath). Only infer the OAuth proxy URL when we have a real base path.
          if (basePath) {
            oauthProxyUrl = `${callbackUrl.origin}${basePath}/api/oauth`;
            // NOTE: We only infer oauthProxyUrl here, NOT connectionUrl.
            // connectionUrl is the MCP gateway/proxy URL that the client connected to,
            // which is different from the OAuth proxy URL. If the client connected
            // directly to the MCP server (no gateway), connectionUrl should remain
            // undefined so the SDK uses the original serverUrl for client info lookup.
          }
          console.log(
            `${logPrefix} Inferred OAuth proxy URL from callback: ${oauthProxyUrl}`
          );
        }
      } catch (e) {
        console.warn(`${logPrefix} Could not infer OAuth proxy URL:`, e);
      }
    }

    // --- Instantiate Provider ---
    console.log(
      `${logPrefix} Re-instantiating provider for server: ${serverUrl}`
    );
    provider = new BrowserOAuthClientProvider(serverUrl, {
      ...providerOptions,
      oauthProxyUrl,
      connectionUrl,
    });

    // Restore PKCE verifier for this auth state.
    // We hydrate both the original state-hash key and the reconstructed provider key
    // to tolerate URL normalization/hash drift between auth start and callback.
    const stateVerifierKey = `${providerOptions.storageKeyPrefix}_${storedStateData.serverUrlHash}_code_verifier`;
    const verifierForState: string | null =
      storedStateData.codeVerifier || localStorage.getItem(stateVerifierKey);

    if (verifierForState) {
      localStorage.setItem(stateVerifierKey, verifierForState);
      localStorage.setItem(provider.getKey("code_verifier"), verifierForState);
    } else {
      throw new Error(
        `[${providerOptions.storageKeyPrefix}] Code verifier missing for OAuth state ${state}. Please restart authentication.`
      );
    }

    // Install fetch interceptor if OAuth proxy was configured or inferred
    // This is needed to bypass CORS for token exchange requests
    if (oauthProxyUrl) {
      console.log(
        `${logPrefix} Installing fetch interceptor for token exchange (proxy: ${oauthProxyUrl})`
      );
      provider.installFetchInterceptor();
    }

    // --- Call SDK Auth Function ---
    console.log(`${logPrefix} Calling SDK auth() to exchange code...`);
    // The SDK auth() function will internally:
    // 1. Use provider.clientInformation()
    // 2. Use provider.codeVerifier()
    // 3. Call exchangeAuthorization()
    // 4. Use provider.saveTokens() on success

    // Use the original MCP server URL for local inspector proxy flows so OAuth token
    // exchange uses the real MCP resource value (not /inspector/api/proxy).
    // Keep gateway URLs as sdkServerUrl when using hosted gateway connections.
    const sdkServerUrl =
      isHostedGatewayConnection && connectionUrl ? connectionUrl : serverUrl;
    console.log(
      `${logPrefix} Using SDK serverUrl: ${sdkServerUrl} (connectionUrl: ${connectionUrl || "none"})`
    );

    const authResult = await auth(provider, {
      serverUrl: sdkServerUrl,
      authorizationCode: code,
    });

    if (authResult === "AUTHORIZED") {
      console.log(`${logPrefix} Authorization successful via SDK auth().`);

      // Check if this was a redirect flow (has returnUrl) or popup flow
      const isRedirectFlow = storedStateData.flowType === "redirect";
      const isPopupWindow = isMcpAuthPopupWindow();

      if (isRedirectFlow && storedStateData.returnUrl) {
        // Redirect flow: navigate back to the original page
        console.log(
          `${logPrefix} Redirect flow complete. Returning to: ${storedStateData.returnUrl}`
        );
        localStorage.removeItem(stateKey);
        window.location.href = storedStateData.returnUrl;
      } else if (window.opener && !window.opener.closed) {
        // Popup flow: notify opener and close
        console.log(`${logPrefix} Popup flow complete. Notifying opener...`);
        window.opener.postMessage(
          { type: "mcp_auth_callback", success: true },
          window.location.origin
        );
        localStorage.removeItem(stateKey);
        window.close();
      } else if (isPopupWindow) {
        // We are inside a popup we opened, but `window.opener` has been
        // severed (COOP, cross-origin redirects, tab grouping, etc.).
        // Navigating to `returnUrl` here would load the full dashboard
        // inside the popup-sized window — instead, show a friendly
        // close-window message and best-effort `window.close()`.
        //
        // Notify the parent over BroadcastChannel since `postMessage` to
        // `window.opener` is unavailable; without this, the parent
        // `useMcp` would be stuck in `authenticating` forever.
        console.log(
          `${logPrefix} Popup flow complete but opener was lost; broadcasting success and rendering close-window message.`
        );
        broadcastAuthCallback(true);
        localStorage.removeItem(stateKey);
        renderCloseWindowMessage(
          "Authentication Successful!",
          "You're authenticated. You can close this window and return to the app."
        );
        try {
          window.close();
        } catch {
          /* close may be blocked when window has multiple history entries; the user can dismiss manually */
        }
      } else if (storedStateData.returnUrl) {
        // Genuine popup-blocker / manual-link case: the auth URL was opened
        // as a top-level navigation in the original tab, so navigating to
        // `returnUrl` correctly returns the user to the originating page.
        console.log(
          `${logPrefix} Popup flow without opener (top-level nav). Returning to: ${storedStateData.returnUrl}`
        );
        localStorage.removeItem(stateKey);
        window.location.href = storedStateData.returnUrl;
      } else {
        // Last resort fallback: no opener and no return URL, redirect to root
        console.warn(
          `${logPrefix} No opener window or return URL detected. Redirecting to root.`
        );
        localStorage.removeItem(stateKey);
        // Try to determine the base path from the current URL
        // e.g., if we're at /inspector/oauth/callback, redirect to /inspector
        const pathParts = window.location.pathname.split("/").filter(Boolean);
        const basePath =
          pathParts.length > 0 && pathParts[pathParts.length - 1] === "callback"
            ? "/" + pathParts.slice(0, -2).join("/")
            : "/";
        window.location.href = basePath || "/";
      }
    } else {
      // This case shouldn't happen if `authorizationCode` is provided to `auth()`
      console.warn(
        `${logPrefix} SDK auth() returned unexpected status: ${authResult}`
      );
      throw new Error(
        `Unexpected result from authentication library: ${authResult}`
      );
    }
  } catch (err) {
    console.error(`${logPrefix} Error during OAuth callback handling:`, err);
    const errorMessage = err instanceof Error ? err.message : String(err);

    // --- Notify Opener and Display Error (Failure) ---
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(
        { type: "mcp_auth_callback", success: false, error: errorMessage },
        window.location.origin
      );
      // Optionally close even on error, depending on UX preference
      // window.close();
    } else if (isMcpAuthPopupWindow()) {
      // Popup whose opener was severed: signal failure to the parent via
      // BroadcastChannel so it leaves the `authenticating` state instead of
      // hanging forever waiting for a postMessage that can't arrive.
      broadcastAuthCallback(false, errorMessage);
    }

    // Display error in the callback window
    try {
      // Clear body content safely
      document.body.innerHTML = "";

      // Create container div
      const container = document.createElement("div");
      container.style.fontFamily = "sans-serif";
      container.style.padding = "20px";

      // Create heading
      const heading = document.createElement("h1");
      heading.textContent = "Authentication Error";
      container.appendChild(heading);

      // Create error message paragraph
      const errorPara = document.createElement("p");
      errorPara.style.color = "red";
      errorPara.style.backgroundColor = "#ffebeb";
      errorPara.style.border = "1px solid red";
      errorPara.style.padding = "10px";
      errorPara.style.borderRadius = "4px";
      errorPara.textContent = errorMessage; // Safely set as text content
      container.appendChild(errorPara);

      // Create close instruction paragraph
      const closePara = document.createElement("p");
      closePara.textContent = "You can close this window or ";
      const closeLink = document.createElement("a");
      closeLink.href = "#";
      closeLink.textContent = "click here to close";
      closeLink.onclick = (e) => {
        e.preventDefault();
        window.close();
        return false;
      };
      closePara.appendChild(closeLink);
      closePara.appendChild(document.createTextNode("."));
      container.appendChild(closePara);

      // Create stack trace pre element if available
      if (err instanceof Error && err.stack) {
        const stackPre = document.createElement("pre");
        stackPre.style.fontSize = "0.8em";
        stackPre.style.color = "#555";
        stackPre.style.marginTop = "20px";
        stackPre.style.whiteSpace = "pre-wrap";
        stackPre.textContent = err.stack; // Safely set as text content
        container.appendChild(stackPre);
      }

      // Append container to body
      document.body.appendChild(container);
    } catch (displayError) {
      console.error(
        `${logPrefix} Could not display error in callback window:`,
        displayError
      );
    }
    // Clean up potentially invalid state on error
    if (stateKey) {
      localStorage.removeItem(stateKey);
    }
    // Clean up potentially dangling auth URL if auth failed badly.
    // Keep code_verifier to allow a retried callback/token exchange to recover.
    // It will be cleared by saveTokens() on success.
    if (provider) {
      localStorage.removeItem(provider.getKey("last_auth_url"));
    }
  }
}
