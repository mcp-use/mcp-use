import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { BrowserOAuthClientProvider } from "./browser.js";
import {
  MCP_AUTH_BROADCAST_CHANNEL,
  MCP_AUTH_CALLBACK_MESSAGE_TYPE,
  type McpAuthCallbackMessage,
} from "./popup.js";
import type { StoredState } from "./session-store.js";

interface AuthCallbackMeta {
  state?: string | null;
  serverUrlHash?: string | null;
}

let inFlightCallback: Promise<void> | null = null;

function isMcpAuthPopupWindow(): boolean {
  return typeof window !== "undefined" && window.name.startsWith("mcp_auth_");
}

function buildCallbackPayload(
  success: boolean,
  error: string | undefined,
  meta: AuthCallbackMeta
): McpAuthCallbackMessage {
  return {
    type: MCP_AUTH_CALLBACK_MESSAGE_TYPE,
    success,
    ...(success ? {} : { error: error ?? "Unknown error" }),
    ...(meta.state ? { state: meta.state } : {}),
    ...(meta.serverUrlHash ? { serverUrlHash: meta.serverUrlHash } : {}),
  };
}

function broadcastCallback(payload: McpAuthCallbackMessage): void {
  if (typeof BroadcastChannel === "undefined") return;

  let channel: BroadcastChannel | undefined;
  try {
    channel = new BroadcastChannel(MCP_AUTH_BROADCAST_CHANNEL);
    channel.postMessage(payload);
  } catch (error) {
    console.warn("[mcp-callback] Failed to broadcast callback result:", error);
  } finally {
    if (channel) {
      setTimeout(() => {
        try {
          channel?.close();
        } catch {
          // Best-effort signaling only.
        }
      }, 0);
    }
  }
}

function renderResult(
  title: string,
  message: string,
  error: boolean,
  returnUrl?: string
): void {
  if (typeof document === "undefined") return;

  document.body.innerHTML = "";
  const container = document.createElement("div");
  container.style.fontFamily = "sans-serif";
  container.style.padding = "20px";

  const heading = document.createElement("h1");
  heading.textContent = title;
  container.appendChild(heading);

  const text = document.createElement("p");
  text.textContent = message;
  if (error) {
    text.style.color = "red";
    text.style.backgroundColor = "#ffebeb";
    text.style.border = "1px solid red";
    text.style.padding = "10px";
    text.style.borderRadius = "4px";
  }
  container.appendChild(text);

  const close = document.createElement("a");
  close.href = "#";
  close.textContent = "Close this window";
  close.onclick = (event) => {
    event.preventDefault();
    window.close();
    return false;
  };
  container.appendChild(close);

  if (returnUrl) {
    const separator = document.createTextNode(" or ");
    const back = document.createElement("a");
    back.href = returnUrl;
    back.textContent = "return to the app";
    container.append(separator, back);
  }

  document.body.appendChild(container);
}

function findStoredState(state: string): {
  key: string;
  value: StoredState;
} {
  const defaultKey = `mcp:auth:state_${state}`;
  let key = localStorage.getItem(defaultKey) ? defaultKey : null;

  if (!key) {
    const suffix = `:state_${state}`;
    for (let index = 0; index < localStorage.length; index++) {
      const candidate = localStorage.key(index);
      if (candidate?.endsWith(suffix)) {
        key = candidate;
        break;
      }
    }
  }

  const serialized = key ? localStorage.getItem(key) : null;
  if (!key || !serialized) {
    throw new Error(`Invalid or expired OAuth state "${state}".`);
  }

  let value: StoredState;
  try {
    value = JSON.parse(serialized) as StoredState;
  } catch {
    localStorage.removeItem(key);
    throw new Error("Failed to parse stored OAuth state.");
  }

  return { key, value };
}

function redirectWithError(returnUrl: string, message: string): void {
  const url = new URL(returnUrl);
  url.searchParams.set("auth_error", "oauth_callback_failed");
  url.searchParams.set("auth_error_description", message);
  window.location.href = url.toString();
}

function signalResult(
  success: boolean,
  error: string | undefined,
  storedState: StoredState | null,
  meta: AuthCallbackMeta
): void {
  const payload = buildCallbackPayload(success, error, meta);
  const returnUrl = storedState?.returnUrl;
  const popup = storedState?.flowType === "popup" || isMcpAuthPopupWindow();

  if (storedState?.flowType === "redirect" && returnUrl) {
    if (success) window.location.href = returnUrl;
    else redirectWithError(returnUrl, error ?? "Authentication failed.");
    return;
  }

  if (window.opener && !window.opener.closed) {
    window.opener.postMessage(payload, window.location.origin);
    window.close();
    return;
  }

  if (popup) {
    broadcastCallback(payload);
    renderResult(
      success ? "Authentication Successful!" : "Authentication Error",
      success
        ? "You're authenticated. You can close this window and return to the app."
        : (error ?? "Authentication failed."),
      !success,
      returnUrl
    );
    try {
      window.close();
    } catch {
      // The browser may forbid closing after a COOP browsing-context swap.
    }
    return;
  }

  if (returnUrl) {
    if (success) window.location.href = returnUrl;
    else redirectWithError(returnUrl, error ?? "Authentication failed.");
    return;
  }

  if (!success) {
    renderResult(
      "Authentication Error",
      error ?? "Authentication failed.",
      true
    );
    return;
  }

  window.location.href = "/";
}

/**
 * Completes the browser OAuth callback once per page load.
 *
 * This host validates the CSRF state and restores the browser provider. The MCP
 * SDK transport owns callback parameter parsing, issuer validation, OAuth error
 * handling, and the authorization-code exchange.
 */
export function onMcpAuthorization(): Promise<void> {
  if (!inFlightCallback) inFlightCallback = completeAuthorization();
  return inFlightCallback;
}

async function completeAuthorization(): Promise<void> {
  const callbackParams = new URLSearchParams(window.location.search);
  const state = callbackParams.get("state");
  let stateKey: string | null = null;
  let storedState: StoredState | null = null;
  let provider: BrowserOAuthClientProvider | null = null;

  try {
    if (!state) {
      throw new Error("OAuth callback is missing the state parameter.");
    }

    const stored = findStoredState(state);
    stateKey = stored.key;
    storedState = stored.value;

    if (!storedState.expiry || storedState.expiry < Date.now()) {
      localStorage.removeItem(stateKey);
      throw new Error(
        "OAuth state has expired. Please start authentication again."
      );
    }

    if (!storedState.providerOptions) {
      throw new Error("Stored OAuth state is missing provider options.");
    }

    const { serverUrl, ...providerOptions } = storedState.providerOptions;
    provider = new BrowserOAuthClientProvider(serverUrl, providerOptions);

    const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {
      authProvider: provider,
      fetch: provider.getProxyFetch(),
    });

    await transport.finishAuth(callbackParams);
    localStorage.removeItem(stateKey);
    signalResult(true, undefined, storedState, {
      state,
      serverUrlHash: storedState.serverUrlHash,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[mcp-callback] OAuth callback failed:", error);

    if (stateKey) localStorage.removeItem(stateKey);
    if (provider) localStorage.removeItem(provider.getKey("last_auth_url"));

    signalResult(false, message, storedState, {
      state,
      serverUrlHash: storedState?.serverUrlHash,
    });
  }
}
