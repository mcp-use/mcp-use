/**
 * `MCP_USE_STORAGE_URL`: chooses a store from the environment, together with
 * `MCP_USE_STORAGE_TOKEN` and `MCP_USE_STORAGE_PREFIX`.
 *
 * Node-only drivers (`ioredis` or `redis`, `pg`, the file adapter) load
 * through dynamic imports of computed specifiers, so neither edge bundlers
 * nor the Node root entry resolve them.
 *
 * @packageDocumentation
 */
import {
  memoryStorage,
  type OAuthProxyStorage,
} from "../oauth/proxy/storage.js";
import {
  postgresStorage,
  type PostgresLikeClient,
} from "./adapters/postgres.js";
import { redisStorage, type RedisLikeClient } from "./adapters/redis.js";
import { upstashStorage } from "./adapters/upstash.js";
import { applyStoragePrefix, validateStoragePrefix } from "./prefix.js";
import { StorageError } from "./types.js";

/** The store an `MCP_USE_STORAGE_URL` value selects. */
export type StorageUrlTarget =
  | {
      /** `upstash`, `https://…` (or `http://` on a loopback host). */
      kind: "upstash";
      /** REST URL. */
      url: string;
      /** REST token. */
      token: string;
      /** `MCP_USE_STORAGE_PREFIX`, or `""`. */
      prefix: string;
    }
  | {
      /** `redis://…` or `rediss://…`. */
      kind: "redis";
      /** Connection URL. */
      url: string;
      /** `MCP_USE_STORAGE_PREFIX`, or `""`. */
      prefix: string;
    }
  | {
      /** `postgres://…` or `postgresql://…`. */
      kind: "postgres";
      /** Connection string. */
      url: string;
      /** `MCP_USE_STORAGE_PREFIX`, or `""`. */
      prefix: string;
    }
  | {
      /** `file:<path>`. */
      kind: "file";
      /** Directory of the file store, as written after `file:`. */
      path: string;
      /** `MCP_USE_STORAGE_PREFIX`, or `""`. */
      prefix: string;
    }
  | {
      /** `memory`. */
      kind: "memory";
      /** `MCP_USE_STORAGE_PREFIX`, or `""`. */
      prefix: string;
    };

/** Where the server runs: edge runtimes cannot open TCP drivers or files. */
export type StorageRuntime = "node" | "edge";

/** Options for {@link parseStorageUrl}. */
export interface ParseStorageUrlOptions {
  /**
   * Edge runtimes accept only `upstash`, `https://…` and `memory`.
   *
   * @defaultValue `"node"`
   */
  runtime?: StorageRuntime;
}

const FORMS =
  "upstash, https://… (with MCP_USE_STORAGE_TOKEN), redis://…, rediss://…, postgres://…, postgresql://…, file:<dir> or memory";

/**
 * Reads `MCP_USE_STORAGE_URL`, `MCP_USE_STORAGE_TOKEN` and
 * `MCP_USE_STORAGE_PREFIX` (and, for `upstash`, `UPSTASH_REDIS_REST_URL` and
 * `_TOKEN` or Vercel's `KV_REST_API_URL` and `_TOKEN`).
 *
 * Whether an ephemeral `memory` store is allowed is decided by the caller,
 * which knows the environment and the listen address.
 *
 * @param env - Environment variables.
 * @param options - The runtime the store must work on.
 * @returns The selected store, or `undefined` when `MCP_USE_STORAGE_URL` is
 * unset or empty.
 * @throws {@link StorageError} `STORAGE_URL_INVALID` for a malformed or
 * incomplete value, `STORAGE_UNSUPPORTED` for a form the runtime cannot use.
 */
export function parseStorageUrl(
  env: Readonly<Record<string, string | undefined>>,
  options: ParseStorageUrlOptions = {}
): StorageUrlTarget | undefined {
  const value = env["MCP_USE_STORAGE_URL"]?.trim() ?? "";
  if (value === "") return undefined;
  let prefix: string;
  try {
    prefix = validateStoragePrefix(
      env["MCP_USE_STORAGE_PREFIX"],
      "MCP_USE_STORAGE_PREFIX"
    );
  } catch (error) {
    throw new StorageError("STORAGE_URL_INVALID", (error as Error).message);
  }
  const edge = options.runtime === "edge";
  const nodeOnly = (name: string): never => {
    throw new StorageError(
      "STORAGE_UNSUPPORTED",
      `MCP_USE_STORAGE_URL=${name}… needs Node.js; on an edge runtime use upstash, https://… or memory, or pass a D1 or Durable Object binding as storage in code.`
    );
  };

  if (value === "memory") return { kind: "memory", prefix };
  if (value === "upstash") {
    const url = env["UPSTASH_REDIS_REST_URL"] ?? env["KV_REST_API_URL"];
    const token = env["UPSTASH_REDIS_REST_TOKEN"] ?? env["KV_REST_API_TOKEN"];
    if (!url || !token) {
      throw new StorageError(
        "STORAGE_URL_INVALID",
        "MCP_USE_STORAGE_URL=upstash needs UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL and KV_REST_API_TOKEN)."
      );
    }
    return { kind: "upstash", url, token, prefix };
  }
  if (value.startsWith("file:")) {
    if (edge) nodeOnly("file:");
    const path = value.startsWith("file://")
      ? decodeURIComponent(new URL(value).pathname)
      : value.slice("file:".length);
    if (path === "") {
      throw new StorageError(
        "STORAGE_URL_INVALID",
        "MCP_USE_STORAGE_URL=file: needs a directory, for example file:./.mcp-use/state."
      );
    }
    return { kind: "file", path, prefix };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new StorageError(
      "STORAGE_URL_INVALID",
      `MCP_USE_STORAGE_URL is not a supported value. Use ${FORMS}.`
    );
  }
  switch (url.protocol) {
    case "https:":
    case "http:": {
      if (url.protocol === "http:" && !isLoopback(url.hostname)) {
        throw new StorageError(
          "STORAGE_URL_INVALID",
          "MCP_USE_STORAGE_URL must use https:// (http:// is accepted only for localhost)."
        );
      }
      const token = env["MCP_USE_STORAGE_TOKEN"]?.trim() ?? "";
      if (token === "") {
        throw new StorageError(
          "STORAGE_URL_INVALID",
          "MCP_USE_STORAGE_URL=https://… needs MCP_USE_STORAGE_TOKEN, the REST token of the Upstash-compatible endpoint."
        );
      }
      return { kind: "upstash", url: value, token, prefix };
    }
    case "redis:":
    case "rediss:":
      if (edge) nodeOnly(url.protocol + "//");
      return { kind: "redis", url: value, prefix };
    case "postgres:":
    case "postgresql:":
      if (edge) nodeOnly(url.protocol + "//");
      return { kind: "postgres", url: value, prefix };
    default:
      throw new StorageError(
        "STORAGE_URL_INVALID",
        `MCP_USE_STORAGE_URL uses an unsupported scheme "${url.protocol}". Use ${FORMS}.`
      );
  }
}

/** Options for {@link openStorageUrl}. */
export interface OpenStorageUrlOptions {
  /**
   * Loads a module by specifier.
   *
   * @defaultValue a dynamic `import()`
   */
  importModule?: (specifier: string) => Promise<unknown>;
}

/**
 * Creates the store a {@link parseStorageUrl} result selects. Loading the
 * driver happens here; connecting waits for the first storage call.
 *
 * @param target - The parsed `MCP_USE_STORAGE_URL`.
 * @param options - Module loader.
 * @returns The store. Check it with `isMcpUseStorage()` before using it for
 * Events.
 * @throws {@link StorageError} `STORAGE_DRIVER_MISSING` when the Redis or
 * Postgres driver is not installed; `STORAGE_UNSUPPORTED` when the file
 * adapter cannot be loaded.
 */
export async function openStorageUrl(
  target: StorageUrlTarget,
  options: OpenStorageUrlOptions = {}
): Promise<OAuthProxyStorage> {
  const load =
    options.importModule ??
    ((specifier: string) => import(/* @vite-ignore */ specifier));
  const tryLoad = async (specifier: string) => {
    try {
      return (await load(specifier)) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  };
  switch (target.kind) {
    case "memory":
      return applyStoragePrefix(memoryStorage(), target.prefix);
    case "upstash":
      return upstashStorage({
        url: target.url,
        token: target.token,
        prefix: target.prefix,
      });
    case "redis": {
      const ioredis = await tryLoad("ioredis");
      const IORedis = classExport(ioredis, "Redis");
      if (IORedis) {
        return redisStorage(() => new IORedis(target.url) as RedisLikeClient, {
          prefix: target.prefix,
        });
      }
      const nodeRedis = await tryLoad("redis");
      const createClient = member(nodeRedis, "createClient");
      if (typeof createClient === "function") {
        return redisStorage(
          () =>
            (
              createClient({ url: target.url }) as {
                connect(): Promise<RedisLikeClient>;
              }
            ).connect(),
          { prefix: target.prefix }
        );
      }
      throw new StorageError(
        "STORAGE_DRIVER_MISSING",
        "MCP_USE_STORAGE_URL=redis://… needs a Redis driver. Run: npm i ioredis"
      );
    }
    case "postgres": {
      const Pool = classExport(await tryLoad("pg"), "Pool");
      if (!Pool) {
        throw new StorageError(
          "STORAGE_DRIVER_MISSING",
          "MCP_USE_STORAGE_URL=postgres://… needs the Postgres driver. Run: npm i pg"
        );
      }
      return postgresStorage({
        client: new Pool({
          connectionString: target.url,
        }) as PostgresLikeClient,
        prefix: target.prefix,
      });
    }
    case "file": {
      const fileStorage = member(
        await tryLoad(["mcp-use", "storage", "node"].join("/")),
        "fileStorage"
      );
      if (typeof fileStorage !== "function") {
        throw new StorageError(
          "STORAGE_UNSUPPORTED",
          "MCP_USE_STORAGE_URL=file:… needs fileStorage from mcp-use/storage/node, which this build of mcp-use cannot load."
        );
      }
      return applyStoragePrefix(
        (fileStorage as (dir: string) => OAuthProxyStorage)(target.path),
        target.prefix
      );
    }
    default: {
      const unknown: never = target;
      throw new StorageError(
        "STORAGE_URL_INVALID",
        `Unknown storage target ${JSON.stringify((unknown as { kind?: unknown }).kind)}`
      );
    }
  }
}

type AnyFunction = (...args: unknown[]) => unknown;
type AnyConstructor = new (...args: unknown[]) => unknown;

/** Reads an export from a module, or from its CommonJS `default`. */
function member(
  module: Record<string, unknown> | undefined,
  name: string
): AnyFunction | undefined {
  const value =
    module?.[name] ??
    (module?.["default"] as Record<string, unknown> | undefined)?.[name];
  return typeof value === "function" ? (value as AnyFunction) : undefined;
}

/** Reads a class export, falling back to a module whose default is the class. */
function classExport(
  module: Record<string, unknown> | undefined,
  name: string
): AnyConstructor | undefined {
  const value = member(module, name) ?? module?.["default"];
  return typeof value === "function" ? (value as AnyConstructor) : undefined;
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".localhost")
  );
}
