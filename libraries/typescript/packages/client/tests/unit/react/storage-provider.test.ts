// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalStorageProvider } from "../../../src/react/storage.js";
import { installMemoryLocalStorage } from "../../helpers/memory-local-storage.js";

describe("LocalStorageProvider secret allowlist", () => {
  let restoreLocalStorage: () => void;

  beforeEach(() => {
    restoreLocalStorage = installMemoryLocalStorage();
    localStorage.clear();
  });

  afterEach(() => {
    restoreLocalStorage();
  });

  it("scrubs legacy secret connection fields on read", () => {
    localStorage.setItem(
      "connections",
      JSON.stringify({
        primary: {
          url: "https://mcp.example.com",
          headers: { Authorization: "Bearer direct-secret" },
          authToken: "legacy-token",
          clientOptions: { requestLogger: "runtime-callback" },
          proxyConfig: {
            proxyAddress: "https://proxy.example.com",
            headers: { Authorization: "Bearer proxy-secret" },
            customHeaders: { "X-Secret": "proxy-custom-secret" },
          },
          oauth: {
            clientId: "public-client-id",
            clientSecret: "oauth-secret",
            scope: "openid",
          },
        },
      })
    );

    const stored = new LocalStorageProvider("connections").getServers();
    expect(stored.primary).toEqual({
      url: "https://mcp.example.com",
      proxyConfig: { proxyAddress: "https://proxy.example.com" },
      oauth: { clientId: "public-client-id", scope: "openid" },
    });

    const migrated = localStorage.getItem("connections");
    expect(migrated).not.toContain("direct-secret");
    expect(migrated).not.toContain("proxy-secret");
    expect(migrated).not.toContain("proxy-custom-secret");
    expect(migrated).not.toContain("oauth-secret");
    expect(migrated).not.toContain("legacy-token");
    expect(migrated).not.toContain("runtime-callback");
  });

  it("applies the allowlist to every write", () => {
    const provider = new LocalStorageProvider("connections");
    provider.setServer("primary", {
      url: "https://mcp.example.com",
      headers: { Authorization: "Bearer runtime-only" },
      proxyConfig: {
        proxyAddress: "https://proxy.example.com",
        headers: { Authorization: "Bearer runtime-only-proxy" },
      },
    } as never);

    expect(provider.getServers().primary).toEqual({
      url: "https://mcp.example.com",
      proxyConfig: { proxyAddress: "https://proxy.example.com" },
    });
    expect(localStorage.getItem("connections")).not.toContain("runtime-only");
  });

  it("returns sanitized servers when the migration rewrite fails", () => {
    localStorage.setItem(
      "connections",
      JSON.stringify({
        primary: {
          url: "https://mcp.example.com",
          headers: { Authorization: "Bearer secret" },
        },
      })
    );
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    expect(new LocalStorageProvider("connections").getServers()).toEqual({
      primary: { url: "https://mcp.example.com" },
    });
  });
});
