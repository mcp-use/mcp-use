// callback.ts
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { BrowserOAuthClientProvider } from "./browser-provider.js"; // Adjust path
import type { StoredState } from "./types.js"; // Adjust path, ensure definition includes providerOptions

/**
 * Handles the OAuth callback using the SDK's auth() function.
 * Assumes it's running on the page specified as the callbackUrl.
 */
export async function onMcpAuthorization() {
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
    if (error) {
      throw new Error(
        `OAuth error: ${error} - ${errorDescription || "No description provided."}`
      );
    }
    if (!code) {
      throw new Error(
        "Authorization code not found in callback query parameters."
      );
    }
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

    // Ensure provider options are present
    if (!storedStateData.providerOptions) {
      throw new Error("Stored state is missing required provider options.");
    }
    const { serverUrl, ...providerOptions } = storedStateData.providerOptions;

    // --- Instantiate Provider ---
    console.log(
      `${logPrefix} Re-instantiating provider for server: ${serverUrl}`
    );
    provider = new BrowserOAuthClientProvider(serverUrl, providerOptions);

    // --- Call SDK Auth Function ---
    console.log(`${logPrefix} Calling SDK auth() to exchange code...`);
    // The SDK auth() function will internally:
    // 1. Use provider.clientInformation()
    // 2. Use provider.codeVerifier()
    // 3. Call exchangeAuthorization()
    // 4. Use provider.saveTokens() on success
    // Extract base URL (origin) for OAuth discovery - OAuth metadata should be at the origin level
    const baseUrl = new URL(serverUrl).origin;
    const authResult = await auth(provider, {
      serverUrl: baseUrl,
      authorizationCode: code,
    });

    if (authResult === "AUTHORIZED") {
      console.log(`${logPrefix} Authorization successful via SDK auth().`);

      // Check if this was a redirect flow (has returnUrl) or popup flow
      const isRedirectFlow = storedStateData.flowType === "redirect";

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
      } else if (storedStateData.returnUrl) {
        // Fallback for popup flow when popup was blocked and user clicked link manually
        // Use the stored returnUrl to navigate back to the original page
        console.log(
          `${logPrefix} Popup flow without opener. Returning to: ${storedStateData.returnUrl}`
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
    // Clean up potentially dangling verifier or last_auth_url if auth failed badly
    // Note: saveTokens should clean these on success
    if (provider) {
      localStorage.removeItem(provider.getKey("code_verifier"));
      localStorage.removeItem(provider.getKey("last_auth_url"));
    }
  }
}
