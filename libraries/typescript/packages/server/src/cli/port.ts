/**
 * Port resolution for `mcp-use dev`: `--port`, else `PORT` env, else 3000 — probing
 * upward when the requested port is taken.
 */

import { createServer } from "node:net";

/** How many consecutive ports to probe before giving up. */
const MAX_PROBES = 100;

/**
 * Outcome of {@link resolvePort}.
 *
 * @internal
 */
export interface ResolvedPort {
  /** The free port to bind. */
  port: number;
  /** The port that was originally requested (differs when probing moved on). */
  requested: number;
}

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
    if (await isPortFree(port, host)) {
      return { port, requested };
    }
  }
  throw new Error(
    `No free port found between ${requested} and ${requested + MAX_PROBES - 1} on ${host}.`
  );
}
