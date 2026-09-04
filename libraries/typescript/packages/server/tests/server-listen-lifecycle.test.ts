import http from "node:http";
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

function getFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, "127.0.0.1", () => {
      const address = s.address();
      const port =
        typeof address === "object" && address !== null ? address.port : 0;
      s.close(() => resolve(port));
    });
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
    const targetPort = await getFreePort();
    const server = new MCPServer({
      name: "close-inflight-test",
      version: "1.0.0",
    });
    const listenPromise = server.listen(targetPort);
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

    // Deterministically verify the target port is closed and not leaking
    expect(await isPortOpen(targetPort)).toBe(false);

    // Verify the port is immediately reusable without EADDRINUSE
    const restartServer = new MCPServer({
      name: "restart-test",
      version: "1.0.0",
    });
    const restartListen = await restartServer.listen(targetPort);
    expect(restartListen.port).toBe(targetPort);
    expect(await isPortOpen(targetPort)).toBe(true);

    await restartServer.close();
    expect(await isPortOpen(targetPort)).toBe(false);
  });

  it("terminates active connections promptly when shutdown races listen()", async () => {
    const targetPort = await getFreePort();
    const server = new MCPServer({
      name: "race-active-req-test",
      version: "1.0.0",
    });

    const listenPromise = server.listen(targetPort);

    // Send a request immediately as the port is binding
    const req = http.get(`http://127.0.0.1:${targetPort}/mcp`);
    req.on("error", () => {
      // Expected connection reset or abort
    });

    const closePromise = server.close();

    const [, closeResult] = await Promise.allSettled([
      listenPromise,
      closePromise,
    ]);

    expect(closeResult.status).toBe("fulfilled");
    expect(await isPortOpen(targetPort)).toBe(false);

    // An immediate restart must succeed
    const restartServer = new MCPServer({
      name: "restart-after-race-test",
      version: "1.0.0",
    });
    const restartListen = await restartServer.listen(targetPort);
    expect(restartListen.port).toBe(targetPort);
    await restartServer.close();
    expect(await isPortOpen(targetPort)).toBe(false);
  });
});
