import { describe, expect, it, vi } from "vitest";

import {
  NodeOAuthClientProvider,
  type NodeOAuthAuthorizationResponse,
} from "../../../src/auth/node.js";
import type { KVStore } from "../../../src/auth/storage.js";

class MemoryKVStore implements KVStore {
  private readonly values = new Map<string, string>();

  get(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  set(key: string, value: string): void {
    this.values.set(key, value);
  }

  remove(key: string): void {
    this.values.delete(key);
  }

  keys(): string[] {
    return [...this.values.keys()];
  }
}

describe("NodeOAuthClientProvider", () => {
  it("preserves RFC 9207 iss from the loopback callback", async () => {
    const openBrowser = vi.fn();
    const provider = await NodeOAuthClientProvider.create(
      "https://mcp.example.com/mcp",
      {
        authTimeoutMs: 5_000,
        kvStore: new MemoryKVStore(),
        openBrowser,
        preferredPort: 35_000 + (process.pid % 1_000),
        portRange: 100,
      }
    );
    const authorizationUrl = new URL("https://auth.example.com/authorize");
    authorizationUrl.searchParams.set("state", "test-state");

    await provider.redirectToAuthorization(authorizationUrl);
    const launcherUrl = `http://127.0.0.1:${provider.callbackPort}/authorize`;
    expect(openBrowser).toHaveBeenCalledWith(launcherUrl);
    const launcherResponse = await fetch(launcherUrl, { redirect: "manual" });
    expect(launcherResponse.status).toBe(302);
    expect(launcherResponse.headers.get("location")).toContain(
      "https://auth.example.com/authorize"
    );
    expect(launcherResponse.headers.get("location")).toContain("state=");
    expect(launcherResponse.headers.get("cache-control")).toBe("no-store");
    const responsePromise: Promise<NodeOAuthAuthorizationResponse> =
      provider.getAuthorizationResponse();
    const legacyCodePromise = provider.getAuthorizationCode();
    const callback = new URL(
      `http://127.0.0.1:${provider.callbackPort}/callback`
    );
    callback.searchParams.set("code", "authorization-code");
    callback.searchParams.set("state", "test-state");
    callback.searchParams.set("iss", "https://auth.example.com");

    const callbackResponse = await fetch(callback);

    expect(callbackResponse.status).toBe(200);
    await expect(responsePromise).resolves.toEqual({
      code: "authorization-code",
      iss: "https://auth.example.com",
    });
    await expect(legacyCodePromise).resolves.toBe("authorization-code");
    expect(openBrowser).toHaveBeenCalledOnce();
  });
});
