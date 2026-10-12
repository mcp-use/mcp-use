/**
 * Records the OAuth proxy keeps in storage. Every value is encrypted by
 * `SecureStore`; token-bearing keys hold SHA-256 hashes, never tokens.
 *
 * @internal
 */
import type { UpstreamTokenSet, UpstreamUser } from "./upstream.js";

/** @internal A client known to the proxy: registered, CIMD, or configured. */
export interface ClientRecord {
  clientId: string;
  redirectUris: string[];
  clientName?: string;
  /** Where the record came from. */
  source: "dcr" | "cimd" | "pre-registered";
  /** Whether the consent page is skipped for this client. */
  trusted: boolean;
}

/** @internal `txn:<id>` — one sign-in in progress (10 minutes). */
export interface TransactionRecord {
  clientId: string;
  redirectUri: string;
  clientState?: string;
  codeChallenge: string;
  resource: string;
  scopes: string[];
  /** PKCE verifier of the proxy's own upstream request. */
  upstreamVerifier: string;
  /** Whether the upstream round was repeated to get a refresh token. */
  retried?: boolean;
}

/** @internal `code:<hash>` — one-time authorization code (60 seconds). */
export interface CodeRecord {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  scopes: string[];
  userKey: string;
  generation: string;
}

/** @internal `grant:<id>` — one signed-in client of one user. */
export interface GrantRecord {
  id: string;
  clientId: string;
  userKey: string;
  /** Must equal the upstream record's generation, or the grant is dead. */
  generation: string;
  scopes: string[];
  resource: string;
}

/** @internal `at:<hash>` — one proxy access token. */
export interface AccessRecord {
  grantId: string;
  expiresAt: number;
}

/** @internal `rt:<hash>` — one proxy refresh token. */
export interface RefreshRecord {
  grantId: string;
  clientId: string;
  state: "active" | "rotated";
  /** Unix seconds when the token was rotated. */
  rotatedAt?: number;
  /** Whether the one grace use after rotation was spent. */
  graceUsed?: boolean;
}

/** @internal `up:<provider>:<subject>` — upstream tokens of one user. */
export interface UpstreamRecord {
  userKey: string;
  /** Random id of this sign-in lineage; revoking the user replaces it. */
  generation: string;
  /** Incremented on every write, for compare-and-set on refresh. */
  version: number;
  tokens: UpstreamTokenSet;
  user: UpstreamUser;
}

/** @internal Storage key builders. */
export const keys = {
  client: (id: string) => `client:${id}`,
  transaction: (id: string) => `txn:${id}`,
  upstreamState: (hash: string) => `ustate:${hash}`,
  code: (hash: string) => `code:${hash}`,
  codeUsed: (hash: string) => `codeused:${hash}`,
  grant: (id: string) => `grant:${id}`,
  access: (hash: string) => `at:${hash}`,
  refresh: (hash: string) => `rt:${hash}`,
  refreshLock: (hash: string) => `lock:rt:${hash}`,
  upstream: (userKey: string) => `up:${userKey}`,
  upstreamLock: (userKey: string) => `lock:up:${userKey}`,
};
