/**
 * Upstash Redis storage over its REST protocol.
 *
 * @packageDocumentation
 */
import { isBuilding } from "../../build-phase.js";
import { trimTrailingSlashes } from "../../oauth/guards.js";
import { applyStoragePrefix, validateStoragePrefix } from "../prefix.js";
import type { McpUseStorage } from "../types.js";
import { redisFamilyStorage } from "./redis.js";

/** Options for {@link upstashStorage}. */
export interface UpstashStorageOptions {
  /** REST URL of the database, for example `UPSTASH_REDIS_REST_URL`. */
  url: string;
  /** REST token of the database, for example `UPSTASH_REDIS_REST_TOKEN`. */
  token: string;
  /** Fetch implementation. Defaults to the global `fetch`. */
  fetch?: typeof globalThis.fetch;
  /**
   * Prepended to every key the store writes, so a credential scoped to
   * `<prefix>*` covers everything the application stores. Must not contain
   * `{` or `}`.
   *
   * @defaultValue `""`
   */
  prefix?: string;
}

/**
 * Creates a store on Upstash Redis over its REST API. It needs only `fetch`,
 * so it runs on Node, Vercel, and Cloudflare Workers alike. Inside
 * `mcp-use build` (see `isBuilding()` in `mcp-use`), the URL and token may be
 * missing.
 *
 * It implements the full `McpUseStorage` contract with the same Lua
 * scripts as `redisStorage`, sent as `EVALSHA` over REST; `batch` uses the
 * REST `/pipeline` endpoint. It has no `signal`, so Events readers poll.
 * Any REST bridge that speaks the Upstash protocol and runs `EVAL` against
 * Redis 6.2 or later works.
 *
 * @param options - REST URL and token of the database, and a key prefix.
 * @returns A store for `oauthProxy` and MCP Events.
 */
export function upstashStorage(options: UpstashStorageOptions): McpUseStorage {
  // `mcp-use build` runs the entry without serving requests, so it needs no
  // credentials. Outside a build, a missing URL or token fails here.
  if (
    (typeof options?.url !== "string" || typeof options.token !== "string") &&
    !isBuilding()
  ) {
    throw new TypeError("upstashStorage requires url and token");
  }
  const prefix = validateStoragePrefix(options?.prefix, "upstashStorage");
  const url = trimTrailingSlashes(String(options?.url));
  const fetchImpl =
    options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const post = async (path: string, body: unknown): Promise<unknown> => {
    const response = await fetchImpl(url + path, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const parsed = (await response.json().catch(() => ({}))) as unknown;
    if (!response.ok) {
      const error = (parsed as { error?: string } | undefined)?.error;
      throw new Error(`Upstash request failed: ${error ?? response.status}`);
    }
    return parsed;
  };
  const unwrap = (name: unknown, body: unknown): unknown => {
    const { result, error } = (body ?? {}) as {
      result?: unknown;
      error?: string;
    };
    if (error !== undefined) {
      throw new Error(`Upstash ${String(name)} failed: ${error}`);
    }
    return result;
  };
  // At most 64 requests are in flight per endpoint in this process, so a
  // burst of appends queues here instead of exhausting sockets on the REST
  // endpoint. Stores with the same URL share the limit.
  let limit = limiters.get(url);
  if (!limit) {
    limit = limiter(64);
    limiters.set(url, limit);
  }
  const command = (args: (string | number)[]): Promise<unknown> =>
    limit(() => send(args));
  const send = async (args: (string | number)[]): Promise<unknown> => {
    // An error reply comes back as HTTP 400 with `{error}`: surface its text
    // (NOSCRIPT fallback depends on it).
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(args.map(String)),
    });
    const body = (await response.json().catch(() => ({}))) as {
      result?: unknown;
      error?: string;
    };
    if (!response.ok || body.error !== undefined) {
      throw new Error(
        `Upstash ${String(args[0])} failed: ${body.error ?? response.status}`
      );
    }
    return body.result;
  };
  return applyStoragePrefix(
    redisFamilyStorage({
      kind: "upstash",
      command,
      pipeline: async (commands) => {
        const replies = (await limit(() =>
          post(
            "/pipeline",
            commands.map((args) => args.map(String))
          )
        )) as unknown[];
        return commands.map((args, i) => {
          try {
            return unwrap(args[0], replies[i]);
          } catch (error) {
            return error as Error;
          }
        });
      },
    }),
    prefix
  );
}

type Limit = <T>(task: () => Promise<T>) => Promise<T>;
const limiters = new Map<string, Limit>();

function limiter(max: number): Limit {
  let active = 0;
  const queue: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= max) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await task();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}
