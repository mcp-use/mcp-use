import { describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import {
  connect,
  createServer as createNetServer,
  type Socket,
} from "node:net";
import { once } from "node:events";
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
  it.each(["success", "error", "cancel", "timeout"] as const)(
    "closes all loopback connections on %s without truncating the response",
    async (outcome) => {
      const provider = await NodeOAuthClientProvider.create(
        "https://mcp.example.com/mcp",
        {
          kvStore: new MemoryKVStore(),
          openBrowser: vi.fn(),
          authTimeoutMs: outcome === "timeout" ? 500 : 5_000,
          preferredPort: 37_000 + (process.pid % 1_000),
          portRange: 100,
        }
      );
      const sockets: Socket[] = [];
      const closed: Promise<unknown>[] = [];
      const openSocket = async () => {
        const socket = connect(provider.callbackPort, "127.0.0.1");
        sockets.push(socket);
        closed.push(
          new Promise<void>((resolve) => socket.once("close", () => resolve()))
        );
        // Force-closing an incomplete request can legitimately reset its TCP connection.
        socket.on("error", () => {});
        socket.resume();
        await once(socket, "connect");
        return socket;
      };

      try {
        await provider.redirectToAuthorization(
          new URL("https://auth.example.com/authorize?state=test-state")
        );
        // Neither an unused TCP connection nor an incomplete request receives
        // a response header, so both require explicit shutdown cleanup.
        await openSocket();
        const incomplete = await openSocket();
        incomplete.write("GET /callback HTTP/1.1\r\nHost: 127.0.0.1\r\n");
        const response = provider.getAuthorizationResponse();

        if (outcome === "success" || outcome === "error") {
          const callback = await openSocket();
          let rawResponse = "";
          callback.setEncoding("utf8");
          callback.on("data", (chunk) => (rawResponse += chunk));
          const query =
            outcome === "success"
              ? "code=test-code&state=test-state"
              : "error=access_denied";
          callback.write(
            `GET /callback?${query} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\n\r\n`
          );
          if (outcome === "success") {
            await expect(response).resolves.toEqual({ code: "test-code" });
          } else {
            await expect(response).rejects.toMatchObject({
              code: "access_denied",
            });
          }
          await Promise.all(closed);
          expect(rawResponse).toContain(
            `HTTP/1.1 ${outcome === "success" ? 200 : 400}`
          );
          expect(rawResponse).toMatch(/connection: close/i);
          expect(rawResponse).toContain(
            outcome === "success"
              ? "Authentication complete"
              : "Authentication failed"
          );
          expect(rawResponse).toContain("</body></html>");
        } else {
          if (outcome === "cancel") provider.dispose();
          await expect(response).rejects.toMatchObject({
            code: outcome === "cancel" ? "cancelled" : "timeout",
          });
          await Promise.all(closed);
        }
      } finally {
        sockets.forEach((socket) => socket.destroy());
        provider.dispose();
      }
    },
    2_000
  );

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
