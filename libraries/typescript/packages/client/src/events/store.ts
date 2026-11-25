/**
 * `EventsStore` implementations and the persisted-record helpers
 * (PLAN.md §9.5, §9.5.4).
 *
 * @packageDocumentation
 */

import { canonicalJson, normalizeArguments } from "@mcp-use/events-core";
import type { ClientSubscriptionRecord, EventsStore } from "./types.js";

/** Store key prefix of subscription records. */
export const RECORD_PREFIX = "sub/";

/**
 * In-memory store (default in Node).
 *
 * @returns A store.
 */
export function memoryEventsStore(): EventsStore {
  const map = new Map<string, string>();
  return {
    async get(key) {
      return map.get(key);
    },
    async set(key, value) {
      map.set(key, value);
    },
    async delete(key) {
      map.delete(key);
    },
    async list(prefix) {
      return [...map.keys()].filter((k) => k.startsWith(prefix)).sort();
    },
  };
}

/**
 * Browser store over `localStorage`.
 *
 * @param prefix - Key prefix; default `"mcp-use:events:"`.
 * @returns A store; behaves as an empty store when `localStorage` is unavailable.
 */
export function localStorageEventsStore(
  prefix = "mcp-use:events:"
): EventsStore {
  const ls = (): Storage | undefined => {
    try {
      return (globalThis as { localStorage?: Storage }).localStorage;
    } catch {
      return undefined;
    }
  };
  return {
    async get(key) {
      try {
        return ls()?.getItem(prefix + key) ?? undefined;
      } catch {
        return undefined;
      }
    },
    async set(key, value) {
      try {
        ls()?.setItem(prefix + key, value);
      } catch {
        /* quota or blocked storage: persistence is best effort */
      }
    },
    async delete(key) {
      try {
        ls()?.removeItem(prefix + key);
      } catch {
        /* ignore */
      }
    },
    async list(p) {
      const s = ls();
      if (!s) return [];
      const out: string[] = [];
      try {
        for (let i = 0; i < s.length; i++) {
          const k = s.key(i);
          if (k && k.startsWith(prefix + p)) out.push(k.slice(prefix.length));
        }
      } catch {
        return [];
      }
      return out.sort();
    },
  };
}

/**
 * Node store: one JSON file per key under `dir`, written atomically (rename).
 *
 * @param dir - Directory.
 * @returns A store.
 */
export function fileEventsStore(dir: string): EventsStore {
  const encode = (key: string) => encodeURIComponent(key) + ".json";
  const decode = (file: string) =>
    decodeURIComponent(file.slice(0, -".json".length));
  const fs = () => import("node:fs/promises");
  const join = async (f: string) => (await import("node:path")).join(dir, f);
  let seq = 0;
  return {
    async get(key) {
      try {
        return await (await fs()).readFile(await join(encode(key)), "utf8");
      } catch {
        return undefined;
      }
    },
    async set(key, value) {
      const f = await fs();
      await f.mkdir(dir, { recursive: true });
      const target = await join(encode(key));
      seq += 1;
      const tmp = `${target}.${Date.now()}.${seq}.tmp`;
      await f.writeFile(tmp, value, "utf8");
      await f.rename(tmp, target);
    },
    async delete(key) {
      try {
        await (await fs()).unlink(await join(encode(key)));
      } catch {
        /* already gone */
      }
    },
    async list(prefix) {
      try {
        const files = await (await fs()).readdir(dir);
        return files
          .filter((f) => f.endsWith(".json"))
          .map(decode)
          .filter((k) => k.startsWith(prefix))
          .sort();
      } catch {
        return [];
      }
    },
  };
}

/**
 * `canonicalJson(normalizeArguments(args))`.
 *
 * @param args - Subscription arguments.
 * @returns The arguments key.
 */
export function argsKeyOf(args: unknown): string {
  return canonicalJson(normalizeArguments(args));
}

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Store key of a record:
 * `sub/<server>/<base64url(SHA-256(name ‖ 0x00 ‖ argsKey))[0..22]>`.
 *
 * @param server - MCPClient server key.
 * @param name - Event name.
 * @param argsKey - Arguments key.
 * @returns The store key.
 */
export async function recordKey(
  server: string,
  name: string,
  argsKey: string
): Promise<string> {
  const data = new TextEncoder().encode(`${name}\u0000${argsKey}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return `${RECORD_PREFIX}${server}/${base64url(digest).slice(0, 22)}`;
}

/**
 * Parse a stored record; unknown fields are preserved.
 *
 * @param raw - The stored JSON.
 * @returns The record, or `undefined` when it is not a v1 record.
 */
export function parseRecord(
  raw: string | undefined
): ClientSubscriptionRecord | undefined {
  if (raw === undefined) return undefined;
  try {
    const r = JSON.parse(raw) as ClientSubscriptionRecord;
    if (r && r.v === 1 && typeof r.name === "string") {
      if (!Array.isArray(r.recentEventIds)) r.recentEventIds = [];
      return r;
    }
  } catch {
    /* corrupt record */
  }
  return undefined;
}
