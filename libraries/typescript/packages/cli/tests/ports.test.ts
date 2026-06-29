import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { findAvailablePort, isPortAvailable } from "../src/utils/ports.js";

const openServers: net.Server[] = [];

async function listenOnEphemeralPort(host = "127.0.0.1") {
  const server = net.createServer();
  openServers.push(server);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server to bind to a numeric port");
  }

  return { server, port: address.port, host };
}

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          if (!server.listening) {
            resolve();
            return;
          }
          server.close((error) => (error ? reject(error) : resolve()));
        })
    )
  );
});

describe("CLI port helpers", () => {
  it("detects a port occupied by a non-HTTP TCP listener", async () => {
    const { port, host } = await listenOnEphemeralPort();

    await expect(isPortAvailable(port, host)).resolves.toBe(false);
  });

  it("checks IPv4 loopback listeners when probing localhost", async () => {
    const { port } = await listenOnEphemeralPort("127.0.0.1");

    await expect(isPortAvailable(port)).resolves.toBe(false);
  });

  it("skips a non-HTTP TCP listener when finding an available port", async () => {
    const { port, host } = await listenOnEphemeralPort();

    const availablePort = await findAvailablePort(port, host);

    expect(availablePort).not.toBe(port);
  });
});
