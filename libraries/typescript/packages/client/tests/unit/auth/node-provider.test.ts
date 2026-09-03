import { describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  it("prefers the persisted callback port over the configured default", async () => {
    const probe = createNetServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const address = probe.address();
    if (!address || typeof address === "string") {
      throw new Error("Port probe did not bind to a TCP port");
    }
    const persistedPort = address.port;
    await new Promise<void>((resolve, reject) =>
      probe.close((error) => (error ? reject(error) : resolve()))
    );

    const kv = new MemoryKVStore();
    kv.set("port", String(persistedPort));
    const provider = await NodeOAuthClientProvider.create(
      "https://mcp.example.com/mcp",
      {
        kvStore: kv,
        preferredPort: persistedPort === 33_418 ? 33_419 : 33_418,
        portRange: 100,
      }
    );

    expect(provider.callbackPort).toBe(persistedPort);
  });

  it("does not create OAuth state on disk until authorization starts", async () => {
    const root = mkdtempSync(join(tmpdir(), "mcp-use-node-oauth-"));
    const baseDir = join(root, "oauth");
    let provider: NodeOAuthClientProvider | undefined;

    try {
      provider = await NodeOAuthClientProvider.create(
        "https://public.example.com/mcp",
        {
          baseDir,
          openBrowser: vi.fn(),
          preferredPort: 33_000 + (process.pid % 1_000),
          portRange: 100,
        }
      );

      expect(existsSync(baseDir)).toBe(false);

      const authorizationUrl = new URL("https://auth.example.com/authorize");
      authorizationUrl.searchParams.set("state", "test-state");
      await provider.redirectToAuthorization(authorizationUrl);

      const portFile = join(baseDir, provider.serverUrlHash, "port");
      expect(readFileSync(portFile, "utf8")).toBe(
        String(provider.callbackPort)
      );
    } finally {
      provider?.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("persists its callback port only when authorization starts", async () => {
    const kv = new MemoryKVStore();
    const set = vi.spyOn(kv, "set");
    const provider = await NodeOAuthClientProvider.create(
      "https://mcp.example.com/mcp",
      {
        kvStore: kv,
        openBrowser: vi.fn(),
        preferredPort: 34_000 + (process.pid % 1_000),
        portRange: 100,
      }
    );

    expect(set).not.toHaveBeenCalled();

    const authorizationUrl = new URL("https://auth.example.com/authorize");
    authorizationUrl.searchParams.set("state", "test-state");
    await provider.redirectToAuthorization(authorizationUrl);

    expect(set).toHaveBeenCalledWith("port", String(provider.callbackPort));
    provider.dispose();
  });

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

  it("re-binds the loopback listener after a failed bind instead of leaking a dead server handle", async () => {
    const port = 36_000 + (process.pid % 1_000);
    const provider = await NodeOAuthClientProvider.create(
      "https://mcp.example.com/mcp",
      {
        authTimeoutMs: 5_000,
        kvStore: new MemoryKVStore(),
        openBrowser: vi.fn(),
        preferredPort: port,
        portRange: 100,
      }
    );
    // Occupy whatever port reservePort actually settled on rather than the
    // preferred one: the preferred port may already be taken by an unrelated
    // process, in which case the provider falls back within the range.
    const boundPort = provider.callbackPort;

    const authorizationUrl = new URL("https://auth.example.com/authorize");
    authorizationUrl.searchParams.set("state", "test-state");
    const launcherUrl = `http://127.0.0.1:${provider.callbackPort}/authorize`;

    // Occupy the reserved loopback port out from under the provider so its
    // own bind attempt fails with EADDRINUSE, mirroring the reservePort/bind
    // race the bug report describes.
    const occupier = createNetServer();
    await new Promise<void>((resolve, reject) => {
      occupier.once("error", reject);
      occupier.listen(boundPort, "127.0.0.1", () => {
        occupier.removeListener("error", reject);
        resolve();
      });
    });
    let occupierClosed = false;

    try {
      await expect(
        provider.redirectToAuthorization(authorizationUrl)
      ).rejects.toMatchObject({ code: "EADDRINUSE" });

      // Free the port back up before retrying.
      await new Promise<void>((resolve, reject) =>
        occupier.close((error) => {
          if (error) return reject(error);
          occupierClosed = true;
          resolve();
        })
      );

      // The port is free again, so this retry must actually bind a fresh
      // listener rather than silently no-op'ing against the dead handle
      // left behind by the failed attempt above.
      await provider.redirectToAuthorization(authorizationUrl);

      const response = await fetch(launcherUrl, { redirect: "manual" });
      expect(response.status).toBe(302);
    } finally {
      provider.dispose();
      if (!occupierClosed) {
        occupier.close();
      }
    }
  });
});
