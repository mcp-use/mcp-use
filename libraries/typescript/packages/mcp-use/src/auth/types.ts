import type { OAuthMetadata } from "@mcp-use/modelcontextprotocol-sdk/shared/auth.js";

/**
 * Internal type for storing OAuth state in localStorage during the OAuth flow.
 * @internal
 */
export interface StoredState {
  expiry: number;
  metadata?: OAuthMetadata; // Optional: might not be needed if auth() rediscovers
  serverUrlHash: string;
  // Add provider options needed on callback:
  providerOptions: {
    serverUrl: string;
    storageKeyPrefix: string;
    clientName: string;
    clientUri: string;
    callbackUrl: string;
  };
  // Track which flow was used (popup vs redirect)
  flowType?: "popup" | "redirect";
  // Store the original page URL for redirect flow so we can return to it
  returnUrl?: string;
}
