// @vitest-environment jsdom

/**
 * Tests for pre-registered OAuth client_id support on BrowserOAuthClientProvider.
 *
 * Related issue: MCP-1399 — Inspector cannot connect to MCP servers using
 * pre-registered OAuth clients (proxy mode) because clientInformation()
 * returned undefined and the SDK fell through to DCR.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OAuthClientInformation } from "@modelcontextprotocol/client";
import { BrowserOAuthClientProvider } from "../../../src/auth/browser.js";
import { LocalStorageKVStore } from "../../../src/auth/storage.js";
import { installMemoryLocalStorage } from "../../helpers/memory-local-storage.js";

const SERVER_URL = "https://mcp.example.com";

describe("BrowserOAuthClientProvider — pre-registered client_id", () => {
  let restoreLocalStorage: () => void;

  beforeEach(() => {
    restoreLocalStorage = installMemoryLocalStorage();
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
    restoreLocalStorage();
  });

  it("returns staticClientInfo from clientInformation() when no DCR client info is stored", async () => {
    const provider = new BrowserOAuthClientProvider(SERVER_URL, {
      callbackUrl: "https://app.example.com/oauth/callback",
      staticClientInfo: { client_id: "preregistered-abc" },
    });

    const info = await provider.clientInformation();
    expect(info).toEqual({ client_id: "preregistered-abc" });
    expect(await provider.getClientCredentials()).toEqual({
      client_id: "preregistered-abc",
    });
  });

  it("staticClientInfo wins over a stale DCR client_info entry in localStorage", async () => {
    const provider = new BrowserOAuthClientProvider(SERVER_URL, {
      callbackUrl: "https://app.example.com/oauth/callback",
      staticClientInfo: { client_id: "preregistered-abc" },
    });

    // Simulate a stale DCR result already cached.
    localStorage.setItem(
      provider.getKey("client_info"),
      JSON.stringify({
        client_id: "stale-dcr-id",
        redirect_uris: ["https://app.example.com/oauth/callback"],
      })
    );

    const info = await provider.clientInformation();
    expect(info?.client_id).toBe("preregistered-abc");
  });

  it("saveClientInformation is a no-op when staticClientInfo is configured", async () => {
    const provider = new BrowserOAuthClientProvider(SERVER_URL, {
      callbackUrl: "https://app.example.com/oauth/callback",
      staticClientInfo: { client_id: "preregistered-abc" },
    });

    await provider.saveClientInformation({ client_id: "should-not-persist" });
    expect(localStorage.getItem(provider.getKey("client_info"))).toBeNull();
  });

  it("falls back to stored DCR client info when no staticClientInfo is set", async () => {
    const provider = new BrowserOAuthClientProvider(SERVER_URL, {
      callbackUrl: "https://app.example.com/oauth/callback",
    });

    await provider.saveClientInformation({ client_id: "dcr-registered" });
    const info = await provider.clientInformation();
    expect(info?.client_id).toBe("dcr-registered");
  });

  it("discards a client secret returned by DCR for a public browser client", async () => {
    const provider = new BrowserOAuthClientProvider(SERVER_URL, {
      callbackUrl: "https://app.example.com/oauth/callback",
    });

    await provider.saveClientInformation({
      client_id: "dcr-public-client",
      client_secret: "must-not-be-persisted",
      token_endpoint_auth_method: "none",
    } as OAuthClientInformation & { token_endpoint_auth_method: "none" });

    expect(await provider.clientInformation()).toEqual({
      client_id: "dcr-public-client",
      token_endpoint_auth_method: "none",
      redirect_uris: [provider.callbackUrl],
    });
    expect(localStorage.getItem(provider.getKey("client_info"))).not.toContain(
      "must-not-be-persisted"
    );
  });

  it("returns undefined from clientInformation() when neither static nor stored info is present", async () => {
    const provider = new BrowserOAuthClientProvider(SERVER_URL, {
      callbackUrl: "https://app.example.com/oauth/callback",
    });

    const info = await provider.clientInformation();
    expect(info).toBeUndefined();
  });

  it("keeps the last attempted authorization URL in memory only", async () => {
    const provider = new BrowserOAuthClientProvider(SERVER_URL, {
      callbackUrl: "https://app.example.com/inspector/oauth/callback",
      preventAutoAuth: true,
    });
    const prepared = await provider.prepareAuthorizationUrl(
      new URL("https://auth.example.com/authorize")
    );

    expect(provider.getLastAttemptedAuthUrl()).toBe(prepared);
    const stored = localStorage.getItem(provider.getKey("last_auth_url"));
    expect(stored).not.toBe(prepared);
    expect(JSON.parse(stored ?? "{}")).toMatchObject({
      v: 1,
      alg: "A256GCM",
    });
  });

  it("does not expose a persisted authorization URL after reload", async () => {
    const first = new BrowserOAuthClientProvider(SERVER_URL, {
      callbackUrl: "https://app.example.com/inspector/oauth/callback",
    });
    await first.prepareAuthorizationUrl(
      new URL("https://auth.example.com/authorize")
    );

    const reloaded = new BrowserOAuthClientProvider(SERVER_URL, {
      callbackUrl: "https://app.example.com/inspector/oauth/callback",
    });
    expect(reloaded.getLastAttemptedAuthUrl()).toBeNull();
  });

  it("clears only authorization state for the current server", async () => {
    const first = new BrowserOAuthClientProvider(SERVER_URL, {
      callbackUrl: "https://app.example.com/oauth/callback",
    });
    const second = new BrowserOAuthClientProvider(
      "https://other.example.com/mcp",
      {
        callbackUrl: "https://app.example.com/oauth/callback",
      }
    );
    await first.prepareAuthorizationUrl(
      new URL("https://auth.example.com/authorize")
    );
    await second.prepareAuthorizationUrl(
      new URL("https://auth.example.com/authorize")
    );

    const firstStatePrefix = `${first.storageKeyPrefix}_${first.serverUrlHash}_state_`;
    const secondStatePrefix = `${second.storageKeyPrefix}_${second.serverUrlHash}_state_`;
    expect(
      Object.keys(localStorage).some((key) => key.startsWith(firstStatePrefix))
    ).toBe(true);
    expect(
      Object.keys(localStorage).some((key) => key.startsWith(secondStatePrefix))
    ).toBe(true);

    first.clearStorage();

    expect(
      Object.keys(localStorage).some((key) => key.startsWith(firstStatePrefix))
    ).toBe(false);
    expect(
      Object.keys(localStorage).some((key) => key.startsWith(secondStatePrefix))
    ).toBe(true);
  });

  it("includes scope in clientMetadata when configured", () => {
    const provider = new BrowserOAuthClientProvider(SERVER_URL, {
      callbackUrl: "https://app.example.com/oauth/callback",
      scope: "openid profile email",
    });

    expect(provider.clientMetadata.scope).toBe("openid profile email");
  });

  it("omits scope from clientMetadata when not configured", () => {
    const provider = new BrowserOAuthClientProvider(SERVER_URL, {
      callbackUrl: "https://app.example.com/oauth/callback",
    });

    expect(provider.clientMetadata.scope).toBeUndefined();
  });

  it("persists staticClientInfo and scope into stored state for the callback to reconstruct", async () => {
    const provider = new BrowserOAuthClientProvider(SERVER_URL, {
      callbackUrl: "https://app.example.com/oauth/callback",
      staticClientInfo: { client_id: "preregistered-abc" },
      scope: "openid profile",
    });

    const authUrl = new URL("https://auth.example.com/authorize");
    await provider.prepareAuthorizationUrl(authUrl);

    // Find the state key written by prepareAuthorizationUrl.
    const stateKey = Object.keys(localStorage).find((k) =>
      k.includes("_state_")
    );
    expect(stateKey).toBeDefined();

    const serialized = await new LocalStorageKVStore().get(stateKey!);
    const stored = JSON.parse(serialized!);
    expect(stored.providerOptions.staticClientInfo).toEqual({
      client_id: "preregistered-abc",
    });
    expect(stored.providerOptions.scope).toBe("openid profile");
  });

  it("rejects a static browser client secret", () => {
    expect(
      () =>
        new BrowserOAuthClientProvider(SERVER_URL, {
          callbackUrl: "https://app.example.com/oauth/callback",
          staticClientInfo: {
            client_id: "preregistered-abc",
            client_secret: "shh-secret",
          },
        })
    ).toThrow(/public clients/);
  });

  it("validates and persists clientMetadataUrl for callback reconstruction", async () => {
    const provider = new BrowserOAuthClientProvider(SERVER_URL, {
      callbackUrl: "https://app.example.com/oauth/callback",
      clientMetadataUrl: "https://app.example.com/oauth/client-metadata.json",
    });

    expect(provider.clientMetadataUrl).toBe(
      "https://app.example.com/oauth/client-metadata.json"
    );
    const authUrl = new URL("https://auth.example.com/authorize");
    await provider.prepareAuthorizationUrl(authUrl);

    const stateKey = Object.keys(localStorage).find((k) =>
      k.includes("_state_")
    );
    expect(stateKey).toBeDefined();

    const serialized = await new LocalStorageKVStore().get(stateKey!);
    const stored = JSON.parse(serialized!);
    expect(stored.providerOptions.clientMetadataUrl).toBe(
      "https://app.example.com/oauth/client-metadata.json"
    );
  });

  it("rejects an invalid CIMD URL using SDK validation", () => {
    expect(
      () =>
        new BrowserOAuthClientProvider(SERVER_URL, {
          callbackUrl: "https://app.example.com/oauth/callback",
          clientMetadataUrl: "http://app.example.com/client-metadata.json",
        })
    ).toThrow(/clientMetadataUrl/);
  });
});
