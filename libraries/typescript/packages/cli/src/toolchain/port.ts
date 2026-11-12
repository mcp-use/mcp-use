/**
 * Bind the dev listener, trying higher ports when the requested port is taken.
 */

import { connect, type Server } from "node:net";

/** How many consecutive ports to probe before giving up. */
const MAX_PROBES = 100;

/** Short timeout for loopback connect probes (ms). */
const CONNECT_PROBE_MS = 300;

/**
 * Outcome of {@link listenOnAvailablePort}.
 *
 * @internal
 */
interface ResolvedPort {
  /** The port owned by the listening server. */
  port: number;
  /** The port that was originally requested (differs when probing moved on). */
  requested: number;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

/** Bind the actual listener; failed attempts leave it available for retry. */
function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ port, host });
  });
}

/** Whether a TCP connect to `host:port` succeeds within {@link CONNECT_PROBE_MS}. */
function canConnect(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host });
    socket.setTimeout(CONNECT_PROBE_MS);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/**
 * On loopback binds, a wildcard listener on `*:port` (IPv6) can still accept
 * `localhost` traffic while `127.0.0.1:port` bind-probes succeed — macOS dual-stack.
 * Check only the other address family after binding, so we never mistake our
 * own listener for a competing service. `localhost` may resolve to either one.
 */
async function otherLoopbackInUse(
  port: number,
  family: string
): Promise<boolean> {
  return canConnect(port, family === "IPv4" ? "::1" : "127.0.0.1");
}

/**
 * Bind and retain the actual dev listener before configuring or importing the
 * application. Port 0 is assigned by the OS; occupied nonzero ports are retried
 * upward. No successful listener is released between selection and startup.
 *
 * @param server - The HTTP server that will serve the application.
 * @param requested - The preferred port.
 * @param host - The host the server will bind.
 * @returns The bound port and the original request for substitution logging.
 * @throws If binding fails or no suitable port is found in 100 attempts.
 *
 * @internal
 */
export async function listenOnAvailablePort(
  server: Server,
  requested: number,
  host: string
): Promise<ResolvedPort> {
  for (let attempt = 0; attempt < MAX_PROBES; attempt++) {
    const candidate = requested === 0 ? 0 : requested + attempt;
    if (candidate > 65535) break;
    try {
      await listen(server, candidate, host);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // Reserved ports on Windows can report EACCES rather than EADDRINUSE.
      if (code === "EADDRINUSE" || code === "EACCES") continue;
      throw error;
    }
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Dev listener did not bind a TCP port.");
    }
    if (
      LOOPBACK_HOSTS.has(host) &&
      (await otherLoopbackInUse(address.port, address.family))
    ) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      continue;
    }
    return { port: address.port, requested };
  }
  if (requested === 0) {
    throw new Error(`No free ephemeral port found on ${host}.`);
  }
  throw new Error(
    `No free port found between ${requested} and ${Math.min(65535, requested + MAX_PROBES - 1)} on ${host}.`
  );
}
