// @vitest-environment jsdom

/**
 * Tests for pre-registered OAuth client_id support on BrowserOAuthClientProvider.
 *
 * Related issue: MCP-1399 — Inspector cannot connect to MCP servers using
 * pre-registered OAuth clients (proxy mode) because clientInformation()
 * returned undefined and the SDK fell through to DCR.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BrowserOAuthClientProvider } from "../../../src/auth/browser.js";
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

  it("returns undefined from clientInformation() when neither static nor stored info is present", async () => {
    const provider = new BrowserOAuthClientProvider(SERVER_URL, {
      callbackUrl: "https://app.example.com/oauth/callback",
    });

    const info = await provider.clientInformation();
    expect(info).toBeUndefined();
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
      k.startsWith("mcp:auth:state_")
    );
    expect(stateKey).toBeDefined();

    const stored = JSON.parse(localStorage.getItem(stateKey!)!);
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
      k.startsWith("mcp:auth:state_")
    );
    expect(stateKey).toBeDefined();

    const stored = JSON.parse(localStorage.getItem(stateKey!)!);
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
