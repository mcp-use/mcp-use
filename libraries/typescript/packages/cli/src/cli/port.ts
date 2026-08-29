/**
 * Port resolution for `mcp-use dev`: `--port`, else `PORT` env, else 3000 — probing
 * upward when the requested port is taken.
 */

import { connect, createServer } from "node:net";
import type { Server } from "node:net";

/** How many consecutive ports to probe before giving up. */
const MAX_PROBES = 100;

/** Short timeout for loopback connect probes (ms). */
const CONNECT_PROBE_MS = 300;

/** Bind retries for {@link listenWithRetry} before giving up on the same port. */
const LISTEN_RETRY_ATTEMPTS = 5;

/** Delay between bind retries in {@link listenWithRetry} (ms). */
const LISTEN_RETRY_DELAY_MS = 100;

/**
 * Outcome of {@link resolvePort}.
 *
 * @internal
 */
interface ResolvedPort {
  /** The free port to bind. */
  port: number;
  /** The port that was originally requested (differs when probing moved on). */
  requested: number;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

/** Check whether `port` is free to bind on `host`. */
function isPortFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", () => resolve(false));
    probe.listen({ port, host }, () => {
      probe.close(() => resolve(true));
    });
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
 * Treat the port as taken when either loopback address already accepts connections.
 */
async function loopbackPortInUse(port: number): Promise<boolean> {
  return (
    (await canConnect(port, "127.0.0.1")) || (await canConnect(port, "::1"))
  );
}

/**
 * Resolve the port to bind: take `requested` (already reduced from
 * `--port` / `PORT` / the default by the caller) and probe upward until a
 * free port is found.
 *
 * @param requested - The preferred port.
 * @param host - The host the server will bind (probing binds the same host).
 * @returns The first free port at or above `requested`, plus the original
 * request so callers can log the substitution.
 * @throws If no free port is found within {@link MAX_PROBES} attempts.
 *
 * @internal
 */
export async function resolvePort(
  requested: number,
  host: string
): Promise<ResolvedPort> {
  for (let port = requested; port < requested + MAX_PROBES; port++) {
    if (!(await isPortFree(port, host))) continue;
    if (LOOPBACK_HOSTS.has(host) && (await loopbackPortInUse(port))) continue;
    return { port, requested };
  }
  throw new Error(
    `No free port found between ${requested} and ${requested + MAX_PROBES - 1} on ${host}.`
  );
}

/**
 * Bind `server` to `port`/`host`, retrying the *same* port a few times on
 * `EADDRINUSE` before giving up.
 *
 * {@link resolvePort} confirms a port is free well before this call — the
 * caller's own entry import and dev-server setup run in between (the port is
 * committed early so entry-module code can read it via `process.env.PORT`
 * before this bind happens). That gap is long enough for another transient
 * prober — a concurrent `resolvePort` probe, a test's own free-port check —
 * to grab and release the same port. Retrying the same port rides out that
 * transient hold; picking a different port this late is not an option, since
 * URLs already baked into the entry's own config would no longer match what
 * the CLI actually binds to.
 *
 * @param server - The (unbound) server to bind.
 * @param port - The port to bind, already confirmed free by {@link resolvePort}.
 * @param host - The host to bind.
 * @throws The last `EADDRINUSE` error after {@link LISTEN_RETRY_ATTEMPTS}
 * attempts, or any other bind error immediately.
 *
 * @internal
 */
export async function listenWithRetry(
  server: Pick<Server, "listen" | "once" | "removeListener">,
  port: number,
  host: string
): Promise<void> {
  for (let attempt = 1; attempt <= LISTEN_RETRY_ATTEMPTS; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: NodeJS.ErrnoException): void => reject(error);
        server.once("error", onError);
        server.listen(port, host, () => {
          server.removeListener("error", onError);
          resolve();
        });
      });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== "EADDRINUSE" || attempt === LISTEN_RETRY_ATTEMPTS)
        throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, LISTEN_RETRY_DELAY_MS)
      );
    }
  }
}
