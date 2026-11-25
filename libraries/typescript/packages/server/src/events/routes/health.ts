/**
 * `GET health` (§12.3.2): `EventsHealth`, the same object
 * `server.events.health()` returns.
 *
 * @internal
 */

import type { EventsHealth, EventsSdkInfo } from "../types.js";
import { json } from "./tick.js";

/** Instance facts merged over the backend's health. */
export interface HealthExtras {
  binding: EventsHealth["binding"];
  sender: EventsHealth["sender"];
  sdk: EventsSdkInfo;
  build: { sha: string };
  ticks: { count: number; last: string | null };
  sweeper: { leader: boolean; instance: string };
  reason?: string;
}

/**
 * Merge backend state with instance facts. A `reason` forces `degraded`.
 *
 * @param base - The backend's health.
 * @param extras - Instance facts.
 */
export function assembleHealth(
  base: EventsHealth,
  extras: HealthExtras
): EventsHealth {
  const out: EventsHealth = {
    ...base,
    binding: extras.binding,
    sender: extras.sender,
    sdk: extras.sdk,
    build: extras.build,
    ticks: { ...extras.ticks },
    sweeper: { ...extras.sweeper },
  };
  if (extras.reason !== undefined) {
    out.state = "degraded";
    out.reason = extras.reason;
  }
  return out;
}

/**
 * Resolve the external `@modelcontextprotocol/server` version: resolve its
 * entry, then walk up to its `package.json`. Node only; undefined elsewhere.
 */
export async function resolveExternalSdkVersion(): Promise<string | undefined> {
  try {
    const [{ createRequire }, fs, path] = await Promise.all([
      import("node:module"),
      import("node:fs"),
      import("node:path"),
    ]);
    const req = createRequire(import.meta.url);
    let dir = path.dirname(req.resolve("@modelcontextprotocol/server"));
    for (let i = 0; i < 8; i++) {
      const p = path.join(dir, "package.json");
      if (fs.existsSync(p)) {
        const pkg = JSON.parse(fs.readFileSync(p, "utf8")) as {
          name?: string;
          version?: string;
        };
        if (pkg.name === "@modelcontextprotocol/server") return pkg.version;
      }
      const up = path.dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Handle the health route.
 *
 * @param health - Produces the health object.
 */
export async function handleHealth(
  health: () => Promise<EventsHealth>
): Promise<Response> {
  return json(200, await health());
}
