import type { OAuthMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";

/**
 * Internal type for storing OAuth state in localStorage during the popup flow.
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
}
