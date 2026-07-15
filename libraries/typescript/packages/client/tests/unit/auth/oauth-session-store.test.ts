/**
 * Unit tests for OAuthSessionStore.
 *
 * Run with:
 *   pnpm --filter mcp-use test:unit -- tests/unit/auth/session-store.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  OAuthSessionStore,
  type OAuthSessionStoreOptions,
} from "../../../src/auth/session-store.js";
import type { KVStore } from "../../../src/auth/storage.js";
import type { StoredState } from "../../../src/auth/types.js";

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

describe("OAuthSessionStore", () => {
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
    it("returns stored tokens without performing protocol work", async () => {
      const { session, kv } = createStore();
      const tokens = {
        access_token: "opaque-token",
        refresh_token: "refresh-1",
      };
      kv.set(session.getKey("tokens"), JSON.stringify(tokens));

      const result = await session.tokens();
      expect(result).toEqual(tokens);
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

  describe("getTokenEndpoint()", () => {
    it("returns the endpoint from persisted SDK discovery state", async () => {
      const { session } = createStore();
      await session.saveDiscoveryState({
        authorizationServerUrl: "https://auth.example.com",
        authorizationServerMetadata: {
          issuer: "https://auth.example.com",
          token_endpoint: "https://auth.example.com/token",
        },
      } as never);

      expect(await session.getTokenEndpoint()).toBe(
        "https://auth.example.com/token"
      );
    });

    it("returns null when SDK discovery state is unavailable", async () => {
      const { session } = createStore();
      expect(await session.getTokenEndpoint()).toBeNull();
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
          clientMetadataUrl:
            "https://app.example.com/oauth/client-metadata.json",
        },
      });

      const state = url.searchParams.get("state");
      const stored = JSON.parse(
        kv.get(`mcp:auth:state_${state}`)!
      ) as StoredState;
      expect(stored.providerOptions.oauthProxyUrl).toBe(
        "https://proxy.example.com/oauth"
      );
      expect(stored.providerOptions.clientMetadataUrl).toBe(
        "https://app.example.com/oauth/client-metadata.json"
      );
    });
  });

  // v2 (SDK @modelcontextprotocol/client) additions: the SDK stamps an
  // `issuer` field onto stored tokens/client info (SEP-2352) and persists
  // OAuth discovery state; the store must round-trip both verbatim.
  describe("v2 issuer stamp + discovery state", () => {
    it("isolates tokens by issuer and returns the latest tokens without context", async () => {
      const { session } = createStore();
      const issuerA = { issuer: "https://issuer-a.example.com" };
      const issuerB = { issuer: "https://issuer-b.example.com" };

      await session.saveTokens({ access_token: "a" }, issuerA);
      await session.saveTokens({ access_token: "b" }, issuerB);

      expect((await session.tokens(issuerA))?.access_token).toBe("a");
      expect((await session.tokens(issuerB))?.access_token).toBe("b");
      expect((await session.tokens())?.access_token).toBe("b");
    });

    it("migrates matching legacy token and client-info keys on contextual reads", async () => {
      const { session, kv } = createStore();
      const ctx = { issuer: "https://issuer.example.com" };
      kv.set(
        session.getKey("tokens"),
        JSON.stringify({ access_token: "legacy", issuer: ctx.issuer })
      );
      kv.set(
        session.getKey("client_info"),
        JSON.stringify({ client_id: "legacy-client", issuer: ctx.issuer })
      );

      expect((await session.tokens(ctx))?.access_token).toBe("legacy");
      expect((await session.clientInformation(ctx))?.client_id).toBe(
        "legacy-client"
      );
      expect(kv.keys().filter((key) => key.includes("tokens_"))).toHaveLength(
        1
      );
      expect(
        kv.keys().filter((key) => key.includes("client_info_"))
      ).toHaveLength(1);
    });

    it("does not return legacy credentials stamped for another issuer", async () => {
      const { session, kv } = createStore();
      kv.set(
        session.getKey("tokens"),
        JSON.stringify({
          access_token: "wrong",
          issuer: "https://issuer-a.example.com",
        })
      );

      expect(
        await session.tokens({ issuer: "https://issuer-b.example.com" })
      ).toBeUndefined();
    });

    it("rejects and purges client information containing a client secret", async () => {
      const { session, kv } = createStore({
        ...DEFAULT_OPTS,
        allowClientSecret: false,
      });
      kv.set(
        session.getKey("client_info"),
        JSON.stringify({ client_id: "legacy", client_secret: "secret" })
      );

      expect(await session.clientInformation()).toBeUndefined();
      expect(kv.get(session.getKey("client_info"))).toBeNull();
      await expect(
        session.saveClientInformation({
          client_id: "new",
          client_secret: "secret",
        })
      ).rejects.toThrow(/public clients/);
      expect(kv.get(session.getKey("client_info"))).toBeNull();
    });

    it("retains client secrets when the platform explicitly allows them", async () => {
      const { session } = createStore({
        ...DEFAULT_OPTS,
        allowClientSecret: true,
      });
      await session.saveClientInformation({
        client_id: "confidential-client",
        client_secret: "secret",
      });

      expect((await session.clientInformation())?.client_secret).toBe("secret");
    });

    it("round-trips the issuer stamp on saved tokens verbatim", async () => {
      const { session } = createStore();
      await session.saveTokens({
        access_token: "at",
        token_type: "Bearer",
        refresh_token: "rt",
        issuer: "https://issuer.example.com",
      } as never);
      const tokens = (await session.tokens()) as {
        issuer?: string;
      };
      expect(tokens?.issuer).toBe("https://issuer.example.com");
    });

    it("round-trips the issuer stamp on saved client information verbatim", async () => {
      const { session } = createStore();
      await session.saveClientInformation({
        client_id: "cid",
        issuer: "https://issuer.example.com",
      } as never);
      const info = (await session.clientInformation()) as {
        issuer?: string;
      };
      expect(info?.issuer).toBe("https://issuer.example.com");
    });

    it("persists and returns OAuth discovery state", async () => {
      const { session } = createStore();
      expect(await session.discoveryState()).toBeUndefined();
      const discovery = {
        authorizationServerUrl: "https://auth.example.com",
        resourceMetadataUrl: "https://mcp.example.com/.well-known/oauth",
      };
      await session.saveDiscoveryState(discovery as never);
      expect(await session.discoveryState()).toEqual(discovery);
    });

    it("clears only discovery state on invalidateCredentials('discovery')", async () => {
      const { session, kv } = createStore();
      await session.saveTokens({
        access_token: "at",
        token_type: "Bearer",
      } as never);
      await session.saveDiscoveryState({
        authorizationServerUrl: "https://auth.example.com",
      } as never);

      await session.invalidateCredentials("discovery");

      expect(await session.discoveryState()).toBeUndefined();
      // tokens survive a discovery-only invalidation
      expect(kv.get(session.getKey("tokens"))).not.toBeNull();
    });
  });
});
