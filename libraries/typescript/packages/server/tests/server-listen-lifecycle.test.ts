import http from "node:http";
import net from "node:net";
import { describe, expect, it } from "vitest";

import { MCPServer } from "../src/index.js";

function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/mcp`, (res) => {
      res.resume();
      resolve(true);
    });
    req.on("error", () => resolve(false));
  });
}

describe("MCPServer.listen lifecycle and concurrency", () => {
  it("rejects repeated listen() on an active server without leaking listeners", async () => {
    const server = new MCPServer({ name: "lifecycle-test", version: "1.0.0" });
    const { port } = await server.listen(0);
    expect(await isPortOpen(port)).toBe(true);

    await expect(server.listen(0)).rejects.toThrow(
      "Cannot call listen() while the server is already listening."
    );

    await server.close();
    expect(await isPortOpen(port)).toBe(false);
  });

  it("handles concurrent listen() calls deterministically with zero leaked listeners", async () => {
    const server = new MCPServer({ name: "concurrent-test", version: "1.0.0" });
    const [first, second] = await Promise.allSettled([
      server.listen(0),
      server.listen(0),
    ]);

    const accepted = first.status === "fulfilled" ? first : second;
    const rejected = first.status === "rejected" ? first : second;

    expect(accepted.status).toBe("fulfilled");
    expect(rejected.status).toBe("rejected");

    if (accepted.status === "fulfilled") {
      expect(typeof accepted.value.port).toBe("number");
      expect(accepted.value.url).toContain(String(accepted.value.port));
      expect(await isPortOpen(accepted.value.port)).toBe(true);
    }

    if (rejected.status === "rejected") {
      expect(rejected.reason).toBeInstanceOf(Error);
      expect((rejected.reason as Error).message).toBe(
        "Cannot call listen() while the server is already listening."
      );
    }

    const boundPort = (accepted as PromiseFulfilledResult<{ port: number }>)
      .value.port;
    await server.close();

    expect(await isPortOpen(boundPort)).toBe(false);
  });

  it("allows retry after a failed listen attempt", async () => {
    // Bind a dummy server to take an ephemeral port
    const occupiedServer = http.createServer();
    const occupiedPort = await new Promise<number>((resolve) => {
      occupiedServer.listen(0, "127.0.0.1", () => {
        const address = occupiedServer.address();
        resolve(
          typeof address === "object" && address !== null ? address.port : 0
        );
      });
    });

    const server = new MCPServer({ name: "retry-test", version: "1.0.0" });

    // Attempting to listen on the occupied port should reject with EADDRINUSE
    await expect(server.listen(occupiedPort)).rejects.toThrow();

    // Close the dummy server to free the port
    await new Promise<void>((resolve) => occupiedServer.close(() => resolve()));

    // A subsequent listen attempt should now succeed and not be blocked by the previous failure
    const retry = await server.listen(occupiedPort);
    expect(retry.port).toBe(occupiedPort);
    expect(await isPortOpen(occupiedPort)).toBe(true);

    await server.close();
    expect(await isPortOpen(occupiedPort)).toBe(false);
  });

  it("cleans up listener when close() is called while listen() is in-flight", async () => {
    const server = new MCPServer({
      name: "close-inflight-test",
      version: "1.0.0",
    });
    const listenPromise = server.listen(0);
    const closePromise = server.close();

    const [listenResult, closeResult] = await Promise.allSettled([
      listenPromise,
      closePromise,
    ]);

    expect(closeResult.status).toBe("fulfilled");
    expect(listenResult.status).toBe("rejected");
    if (listenResult.status === "rejected") {
      expect((listenResult.reason as Error).message).toContain("closed");
    }

    // Verify a fresh server instance can immediately bind port 0 and serve requests without leaked listeners
    const restartServer = new MCPServer({
      name: "restart-test",
      version: "1.0.0",
    });
    const restartListen = await restartServer.listen(0);
    expect(typeof restartListen.port).toBe("number");
    expect(await isPortOpen(restartListen.port)).toBe(true);

    await restartServer.close();
    expect(await isPortOpen(restartListen.port)).toBe(false);
  });

  it("terminates active connections promptly on shutdown", async () => {
    const server = new MCPServer({
      name: "active-conn-test",
      version: "1.0.0",
    });
    const { port } = await server.listen(0);
    expect(await isPortOpen(port)).toBe(true);

    // Establish and synchronize on a confirmed active socket connection
    const socket = net.connect(port, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("error", reject);
    });

    const socketClosed = new Promise<void>((resolve) => {
      if (socket.destroyed) resolve();
      else socket.once("close", () => resolve());
    });

    await server.close();
    await socketClosed;

    expect(socket.destroyed).toBe(true);
    expect(await isPortOpen(port)).toBe(false);

    // An immediate restart on port 0 must succeed
    const restartServer = new MCPServer({
      name: "restart-after-close-test",
      version: "1.0.0",
    });
    const restartListen = await restartServer.listen(0);
    expect(typeof restartListen.port).toBe("number");
    expect(await isPortOpen(restartListen.port)).toBe(true);
    await restartServer.close();
    expect(await isPortOpen(restartListen.port)).toBe(false);
  });
});
