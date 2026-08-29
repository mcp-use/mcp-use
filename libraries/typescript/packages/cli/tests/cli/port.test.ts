import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { listenWithRetry, resolvePort } from "../../src/cli/port.js";
import { getFreePort, occupyPort } from "./helpers.js";

describe("listenWithRetry", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  });

  it("binds immediately when the port is free", async () => {
    const port = await getFreePort();
    const server = createServer();
    cleanups.push(() => new Promise<void>((r) => server.close(() => r())));

    await listenWithRetry(server, port, "127.0.0.1");

    const address = server.address();
    expect(
      address && typeof address === "object" ? address.port : undefined
    ).toBe(port);
  });

  it("rides out a transient EADDRINUSE by retrying the same port", async () => {
    const port = await getFreePort();

    // Simulate the reported race: something else holds the port for a
    // moment right as we try to bind it, then releases it shortly after —
    // the same shape as another `resolvePort` probe or a concurrent test's
    // own free-port check landing in the gap between "confirmed free" and
    // "actually bound".
    const blocker = await occupyPort(port);
    setTimeout(() => blocker.close(), 150);

    const server = createServer();
    cleanups.push(() => new Promise<void>((r) => server.close(() => r())));

    await listenWithRetry(server, port, "127.0.0.1");

    const address = server.address();
    expect(
      address && typeof address === "object" ? address.port : undefined
    ).toBe(port);
  });

  it("throws the EADDRINUSE error after exhausting retries against a port held for good", async () => {
    const port = await getFreePort();
    const blocker = await occupyPort(port);
    cleanups.push(() => new Promise<void>((r) => blocker.close(() => r())));

    const server = createServer();
    cleanups.push(() => new Promise<void>((r) => server.close(() => r())));

    await expect(
      listenWithRetry(server, port, "127.0.0.1")
    ).rejects.toMatchObject({ code: "EADDRINUSE" });
  });

  it("rejects immediately on a non-EADDRINUSE bind error without retrying", async () => {
    const server = createServer();
    cleanups.push(() => new Promise<void>((r) => server.close(() => r())));

    // Port 0 with an invalid host triggers a bind error that is not
    // EADDRINUSE (e.g. EADDRNOTAVAIL / ENOTFOUND depending on platform) —
    // retrying that would just waste the full retry budget on something
    // that will never succeed.
    await expect(
      listenWithRetry(server, 80, "256.256.256.256")
    ).rejects.not.toMatchObject({ code: "EADDRINUSE" });
  });
});

describe("resolvePort", () => {
  it("still returns the requested port unbound, leaving the actual bind to the caller", async () => {
    const port = await getFreePort();
    const { port: resolved, requested } = await resolvePort(port, "127.0.0.1");
    expect(resolved).toBe(port);
    expect(requested).toBe(port);

    // The port must still be free — resolvePort must not have left anything
    // bound behind it.
    const server: Server = await new Promise((resolve, reject) => {
      const s = createServer();
      s.once("error", reject);
      s.listen({ port, host: "127.0.0.1" }, () => resolve(s));
    });
    await new Promise<void>((r) => server.close(() => r()));
  });
});
