/**
 * Unit tests for OAuthSessionStore.
 *
 * Run with:
 *   pnpm --filter mcp-use test:unit -- tests/unit/auth/oauth-session-store.test.ts
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  OAuthSessionStore,
  type OAuthSessionStoreOptions,
} from "../../../src/auth/oauth-session-store.js";
import type { KVStore } from "../../../src/auth/kv-store.js";
import type { StoredState } from "../../../src/auth/types.js";

// ---- Mocks for SDK refresh path ----
//
// `tokens()` triggers a refresh via:
//   discoverOAuthProtectedResourceMetadata
//   discoverAuthorizationServerMetadata
//   refreshAuthorization
// from `@modelcontextprotocol/sdk/client/auth.js`. These are real network
// calls in production — mock them here per CLAUDE.md guidance.
const discoverOAuthProtectedResourceMetadata = vi.fn();
const discoverAuthorizationServerMetadata = vi.fn();
const refreshAuthorization = vi.fn();

vi.mock("@modelcontextprotocol/sdk/client/auth.js", () => ({
  discoverOAuthProtectedResourceMetadata: (...args: unknown[]) =>
    discoverOAuthProtectedResourceMetadata(...args),
  discoverAuthorizationServerMetadata: (...args: unknown[]) =>
    discoverAuthorizationServerMetadata(...args),
  refreshAuthorization: (...args: unknown[]) => refreshAuthorization(...args),
}));

// ---- In-memory KVStore for tests ----

class MemoryKVStore implements KVStore {
  data = new Map<string, string>();

  get(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  set(key: string, value: string): void {
    this.data.set(key, value);
  }

  remove(key: string): void {
    this.data.delete(key);
  }

  keys(): string[] {
    return [...this.data.keys()];
  }
}

// ---- Helpers ----

const SERVER_URL = "https://mcp.example.com/sse";
const DEFAULT_OPTS: OAuthSessionStoreOptions = {
  storageKeyPrefix: "mcp:auth",
  clientName: "test-client",
  clientUri: "https://test.example.com",
  logoUri: "https://test.example.com/logo.png",
  callbackUrl: "https://test.example.com/oauth/callback",
};

function createStore(opts: OAuthSessionStoreOptions = DEFAULT_OPTS): {
  session: OAuthSessionStore;
  kv: MemoryKVStore;
} {
  const kv = new MemoryKVStore();
  const session = new OAuthSessionStore(SERVER_URL, opts, kv);
  return { session, kv };
}

/**
 * Build an unsigned JWT-shaped string with the given exp (seconds).
 * The session store decodes the payload via atob(token.split(".")[1]).
 */
function buildJwt(payload: Record<string, unknown>): string {
  const b64 = (obj: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64(payload)}.sig`;
}

describe("OAuthSessionStore", () => {
  beforeEach(() => {
    discoverOAuthProtectedResourceMetadata.mockReset();
    discoverAuthorizationServerMetadata.mockReset();
    refreshAuthorization.mockReset();
  });

  describe("getKey()", () => {
    it("returns prefix_hash_suffix", () => {
      const { session } = createStore();
      const key = session.getKey("tokens");
      expect(key).toBe(`mcp:auth_${session.serverUrlHash}_tokens`);
    });

    it("uses the same hash for the same serverUrl", () => {
      const { session: a } = createStore();
      const { session: b } = createStore();
      expect(a.serverUrlHash).toBe(b.serverUrlHash);
    });
  });

  describe("redirectUrl + clientMetadata", () => {
    it("redirectUrl is the sanitized callback URL", () => {
      const { session } = createStore();
      expect(session.redirectUrl).toBe(
        "https://test.example.com/oauth/callback"
      );
    });

    it("clientMetadata has expected fields", () => {
      const { session } = createStore();
      const md = session.clientMetadata;
      expect(md.redirect_uris).toEqual([session.redirectUrl]);
      expect(md.token_endpoint_auth_method).toBe("none");
      expect(md.grant_types).toEqual(["authorization_code", "refresh_token"]);
      expect(md.response_types).toEqual(["code"]);
      expect(md.client_name).toBe("test-client");
      expect(md.client_uri).toBe("https://test.example.com");
      expect(md.logo_uri).toBe("https://test.example.com/logo.png");
    });
  });

  describe("tokens()", () => {
    it("returns stored tokens unchanged when JWT exp is far in the future", async () => {
      const { session, kv } = createStore();
      const tokens = {
        access_token: buildJwt({ exp: Math.floor(Date.now() / 1000) + 3600 }),
        refresh_token: "refresh-1",
      };
      kv.set(session.getKey("tokens"), JSON.stringify(tokens));

      const result = await session.tokens();
      expect(result).toEqual(tokens);
      expect(refreshAuthorization).not.toHaveBeenCalled();
    });

    it("returns stored tokens as-is when access_token is not a JWT", async () => {
      const { session, kv } = createStore();
      const tokens = {
        access_token: "opaque-not-a-jwt",
        refresh_token: "refresh-1",
      };
      kv.set(session.getKey("tokens"), JSON.stringify(tokens));

      const result = await session.tokens();
      expect(result).toEqual(tokens);
      expect(refreshAuthorization).not.toHaveBeenCalled();
    });

    it("triggers refresh when JWT exp is within 30s", async () => {
      const { session, kv } = createStore();
      const tokens = {
        access_token: buildJwt({ exp: Math.floor(Date.now() / 1000) + 5 }),
        refresh_token: "refresh-1",
      };
      kv.set(session.getKey("tokens"), JSON.stringify(tokens));
      kv.set(
        session.getKey("client_info"),
        JSON.stringify({ client_id: "abc" })
      );

      const refreshed = {
        access_token: buildJwt({
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
        refresh_token: "refresh-2",
      };

      discoverOAuthProtectedResourceMetadata.mockResolvedValue({
        authorization_servers: ["https://auth.example.com"],
      });
      discoverAuthorizationServerMetadata.mockResolvedValue({
        issuer: "https://auth.example.com",
      });
      refreshAuthorization.mockResolvedValue(refreshed);

      const result = await session.tokens();
      expect(refreshAuthorization).toHaveBeenCalledTimes(1);
      expect(result).toEqual(refreshed);
      // Refreshed tokens should be persisted via saveTokens()
      expect(kv.get(session.getKey("tokens"))).toBe(JSON.stringify(refreshed));
    });

    it("returns the original tokens when refresh fails", async () => {
      const { session, kv } = createStore();
      const tokens = {
        access_token: buildJwt({ exp: Math.floor(Date.now() / 1000) + 5 }),
        refresh_token: "refresh-1",
      };
      kv.set(session.getKey("tokens"), JSON.stringify(tokens));
      kv.set(
        session.getKey("client_info"),
        JSON.stringify({ client_id: "abc" })
      );

      discoverOAuthProtectedResourceMetadata.mockRejectedValue(
        new Error("network down")
      );

      const result = await session.tokens();
      // _refresh swallows errors and returns null, so tokens() falls through
      // and returns the (still-cached) tokens unchanged.
      expect(result).toEqual(tokens);
    });

    it("dedupes concurrent refresh calls into a single SDK invocation", async () => {
      const { session, kv } = createStore();
      const tokens = {
        access_token: buildJwt({ exp: Math.floor(Date.now() / 1000) + 5 }),
        refresh_token: "refresh-1",
      };
      kv.set(session.getKey("tokens"), JSON.stringify(tokens));
      kv.set(
        session.getKey("client_info"),
        JSON.stringify({ client_id: "abc" })
      );

      const refreshed = {
        access_token: buildJwt({
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
        refresh_token: "refresh-2",
      };
      discoverOAuthProtectedResourceMetadata.mockResolvedValue({
        authorization_servers: ["https://auth.example.com"],
      });
      discoverAuthorizationServerMetadata.mockResolvedValue({
        issuer: "https://auth.example.com",
      });

      // Hold refreshAuthorization until both callers are waiting.
      let releaseRefresh!: () => void;
      const refreshGate = new Promise<void>((resolve) => {
        releaseRefresh = resolve;
      });
      refreshAuthorization.mockImplementation(async () => {
        await refreshGate;
        return refreshed;
      });

      const p1 = session.tokens();
      const p2 = session.tokens();

      releaseRefresh();

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toEqual(refreshed);
      expect(r2).toEqual(refreshed);
      expect(refreshAuthorization).toHaveBeenCalledTimes(1);
    });

    it("removes the tokens key when stored JSON is malformed", async () => {
      const { session, kv } = createStore();
      kv.set(session.getKey("tokens"), "not-json{");
      const result = await session.tokens();
      expect(result).toBeUndefined();
      expect(kv.get(session.getKey("tokens"))).toBeNull();
    });
  });

  describe("saveTokens()", () => {
    it("persists tokens and clears code_verifier + last_auth_url", async () => {
      const { session, kv } = createStore();
      kv.set(session.getKey("code_verifier"), "verifier");
      kv.set(session.getKey("last_auth_url"), "https://example.com/auth");

      const tokens = { access_token: "abc", refresh_token: "ref" };
      await session.saveTokens(tokens);

      expect(kv.get(session.getKey("tokens"))).toBe(JSON.stringify(tokens));
      expect(kv.get(session.getKey("code_verifier"))).toBeNull();
      expect(kv.get(session.getKey("last_auth_url"))).toBeNull();
    });
  });

  describe("clientInformation()", () => {
    it("returns stored info when redirect_uris is empty (server omitted it)", async () => {
      const { session, kv } = createStore();
      const info = { client_id: "abc", redirect_uris: [] };
      kv.set(session.getKey("client_info"), JSON.stringify(info));

      const result = await session.clientInformation();
      expect(result).toEqual(info);
    });

    it("returns stored info when redirect_uris includes the configured redirectUrl", async () => {
      const { session, kv } = createStore();
      const info = {
        client_id: "abc",
        redirect_uris: [session.redirectUrl, "https://other.example.com/cb"],
      };
      kv.set(session.getKey("client_info"), JSON.stringify(info));

      const result = await session.clientInformation();
      expect(result).toEqual(info);
    });

    it("invalidates client_info, tokens, and last_auth_url on redirect URI mismatch", async () => {
      const { session, kv } = createStore();
      const info = {
        client_id: "abc",
        redirect_uris: ["https://different.example.com/oauth/callback"],
      };
      kv.set(session.getKey("client_info"), JSON.stringify(info));
      kv.set(session.getKey("tokens"), JSON.stringify({ access_token: "x" }));
      kv.set(session.getKey("last_auth_url"), "https://example.com/auth");

      const result = await session.clientInformation();
      expect(result).toBeUndefined();
      expect(kv.get(session.getKey("client_info"))).toBeNull();
      expect(kv.get(session.getKey("tokens"))).toBeNull();
      expect(kv.get(session.getKey("last_auth_url"))).toBeNull();
    });

    it("returns undefined and removes the key when JSON is malformed", async () => {
      const { session, kv } = createStore();
      kv.set(session.getKey("client_info"), "not-json{");

      const result = await session.clientInformation();
      expect(result).toBeUndefined();
      expect(kv.get(session.getKey("client_info"))).toBeNull();
    });

    it("returns undefined when nothing is stored", async () => {
      const { session } = createStore();
      const result = await session.clientInformation();
      expect(result).toBeUndefined();
    });
  });

  describe("invalidateCredentials()", () => {
    function seed(session: OAuthSessionStore, kv: MemoryKVStore) {
      kv.set(session.getKey("tokens"), "tokens");
      kv.set(session.getKey("client_info"), "client");
      kv.set(session.getKey("code_verifier"), "verifier");
      kv.set(session.getKey("last_auth_url"), "auth");
    }

    it("'all' removes tokens, client_info, code_verifier, last_auth_url", async () => {
      const { session, kv } = createStore();
      seed(session, kv);
      await session.invalidateCredentials("all");
      expect(kv.get(session.getKey("tokens"))).toBeNull();
      expect(kv.get(session.getKey("client_info"))).toBeNull();
      expect(kv.get(session.getKey("code_verifier"))).toBeNull();
      expect(kv.get(session.getKey("last_auth_url"))).toBeNull();
    });

    it("'client' removes only client_info", async () => {
      const { session, kv } = createStore();
      seed(session, kv);
      await session.invalidateCredentials("client");
      expect(kv.get(session.getKey("tokens"))).toBe("tokens");
      expect(kv.get(session.getKey("client_info"))).toBeNull();
      expect(kv.get(session.getKey("code_verifier"))).toBe("verifier");
      expect(kv.get(session.getKey("last_auth_url"))).toBe("auth");
    });

    it("'tokens' removes only tokens", async () => {
      const { session, kv } = createStore();
      seed(session, kv);
      await session.invalidateCredentials("tokens");
      expect(kv.get(session.getKey("tokens"))).toBeNull();
      expect(kv.get(session.getKey("client_info"))).toBe("client");
      expect(kv.get(session.getKey("code_verifier"))).toBe("verifier");
      expect(kv.get(session.getKey("last_auth_url"))).toBe("auth");
    });

    it("'verifier' removes only code_verifier", async () => {
      const { session, kv } = createStore();
      seed(session, kv);
      await session.invalidateCredentials("verifier");
      expect(kv.get(session.getKey("tokens"))).toBe("tokens");
      expect(kv.get(session.getKey("client_info"))).toBe("client");
      expect(kv.get(session.getKey("code_verifier"))).toBeNull();
      expect(kv.get(session.getKey("last_auth_url"))).toBe("auth");
    });
  });

  describe("codeVerifier() / saveCodeVerifier()", () => {
    it("round-trips the verifier through KVStore", async () => {
      const { session, kv } = createStore();
      await session.saveCodeVerifier("verifier-abc");
      expect(kv.get(session.getKey("code_verifier"))).toBe("verifier-abc");
      expect(await session.codeVerifier()).toBe("verifier-abc");
    });

    it("throws when the verifier is missing", async () => {
      const { session } = createStore();
      await expect(session.codeVerifier()).rejects.toThrow(
        /Code verifier not found/
      );
    });
  });

  describe("storeAuthorizationState()", () => {
    it("persists StoredState, sets state param, persists last_auth_url, and returns sanitized URL", async () => {
      const { session, kv } = createStore();
      await session.saveCodeVerifier("v1");
      const url = new URL("https://auth.example.com/authorize?foo=bar");

      const before = Date.now();
      const sanitizedUrl = await session.storeAuthorizationState(url, {
        flowType: "popup",
        returnUrl: "https://app.example.com/page",
      });
      const after = Date.now();

      // state param appended on the URL we passed in
      const state = url.searchParams.get("state");
      expect(state).toBeTruthy();

      // returned URL is sanitized + carries the state
      expect(sanitizedUrl).toContain(`state=${state}`);
      expect(sanitizedUrl).toMatch(/^https:\/\/auth\.example\.com\/authorize/);

      // last_auth_url persisted
      expect(kv.get(session.getKey("last_auth_url"))).toBe(sanitizedUrl);

      // StoredState persisted under `${prefix}:state_${state}`
      const stateKey = `mcp:auth:state_${state}`;
      const storedJson = kv.get(stateKey);
      expect(storedJson).toBeTruthy();
      const stored = JSON.parse(storedJson!) as StoredState;
      expect(stored.serverUrlHash).toBe(session.serverUrlHash);
      expect(stored.codeVerifier).toBe("v1");
      expect(stored.flowType).toBe("popup");
      expect(stored.returnUrl).toBe("https://app.example.com/page");
      expect(stored.providerOptions.serverUrl).toBe(SERVER_URL);
      expect(stored.providerOptions.storageKeyPrefix).toBe("mcp:auth");
      expect(stored.providerOptions.clientName).toBe("test-client");
      expect(stored.providerOptions.clientUri).toBe("https://test.example.com");
      expect(stored.providerOptions.callbackUrl).toBe(
        "https://test.example.com/oauth/callback"
      );

      // expiry ~10 minutes out
      expect(stored.expiry).toBeGreaterThanOrEqual(before + 1000 * 60 * 10);
      expect(stored.expiry).toBeLessThanOrEqual(after + 1000 * 60 * 10 + 50);
    });

    it("threads extraProviderOptions into providerOptions", async () => {
      const { session, kv } = createStore();
      await session.saveCodeVerifier("v1");
      const url = new URL("https://auth.example.com/authorize");

      await session.storeAuthorizationState(url, {
        extraProviderOptions: {
          oauthProxyUrl: "https://proxy.example.com/oauth",
          connectionUrl: "https://gateway.example.com/proxy/123",
        },
      });

      const state = url.searchParams.get("state");
      const stored = JSON.parse(
        kv.get(`mcp:auth:state_${state}`)!
      ) as StoredState;
      expect(stored.providerOptions.oauthProxyUrl).toBe(
        "https://proxy.example.com/oauth"
      );
      expect(stored.providerOptions.connectionUrl).toBe(
        "https://gateway.example.com/proxy/123"
      );
    });
  });
});
