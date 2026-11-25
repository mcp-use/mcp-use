/**
 * Redis storage through a node-redis or ioredis client, and the Redis-family
 * core `upstashStorage` shares.
 *
 * @packageDocumentation
 */
import type { OAuthProxyStorage } from "../../oauth/proxy/storage.js";
import { applyStoragePrefix, validateStoragePrefix } from "../prefix.js";
import type {
  IndexRangePage,
  LogAppendResult,
  LogRangeResult,
  McpUseStorage,
  StorageOp,
  StorageSignal,
  Versioned,
} from "../types.js";
import {
  INCR,
  INDEX_RANGE,
  LOG_APPEND,
  LOG_RANGE,
  READ,
  REMOVE,
  WRITE,
} from "../lua/scripts.js";
import { randomEpoch } from "./memory.js";

/** A node-redis (v4+) client: anything with `sendCommand(args)`. */
export interface NodeRedisLikeClient {
  /** Sends a raw command, for example `["GET", "key"]`. */
  sendCommand(args: string[]): Promise<unknown>;
}

/** An ioredis client: anything with `call(command, ...args)`. */
export interface IORedisLikeClient {
  /** Sends a raw command, for example `call("GET", "key")`. */
  call(command: string, ...args: string[]): Promise<unknown>;
}

/** A node-redis or ioredis client accepted by {@link redisStorage}. */
export type RedisLikeClient = NodeRedisLikeClient | IORedisLikeClient;

/**
 * A connection in subscriber mode for {@link redisStorage}'s `signal`: an
 * ioredis client (`subscribe(channel)` plus `on("message")`) or a node-redis
 * client (`subscribe(channel, listener)`).
 */
export type RedisSubscriberLike = object;

/** Options for {@link redisStorage}. */
export interface RedisStorageOptions {
  /**
   * Prepended to every key the store writes, so a Redis ACL key pattern
   * `~<prefix>*` covers everything the application stores. Must not
   * contain `{` or `}`.
   *
   * @defaultValue `""`
   */
  prefix?: string;
  /**
   * A dedicated connection for `signal` subscriptions. When omitted, the
   * store calls `duplicate()` on the client the first time a reader
   * subscribes. Pass `false` to turn `signal` off, so readers poll the log.
   */
  subscriber?:
    | RedisSubscriberLike
    | (() => RedisSubscriberLike | PromiseLike<RedisSubscriberLike>)
    | false;
}

/**
 * Creates a store on Redis (6.2 or later) through a node-redis or ioredis
 * client. It implements the full `McpUseStorage` contract: every compound
 * operation is one Lua script whose keys are all passed in `KEYS[]`, so it
 * works with Redis ACL key patterns and on Redis Cluster when the keys of
 * one log share a hash tag. `signal` uses `PUBLISH` and a duplicated
 * subscriber connection.
 *
 * Pass a connected client, or a function that connects one. The function
 * runs on the first storage call, which keeps importing the server free of
 * network calls: `mcp-use build` and serverless cold starts do not wait on
 * Redis. Concurrent first calls share one connection attempt, and a failed
 * attempt is retried on the next call. With a function, a wrong URL shows up
 * at the first sign-in rather than at startup.
 *
 * @param client - A connected node-redis or ioredis client, or a function
 * that returns one or a promise of one.
 * @param options - Key prefix and subscriber connection.
 * @returns A store for `oauthProxy` and MCP Events.
 *
 * @example
 * ```ts
 * import { createClient } from "redis";
 * import { redisStorage } from "mcp-use/storage";
 *
 * const storage = redisStorage(() =>
 *   createClient({ url: process.env.REDIS_URL })
 *     .on("error", (error) => console.error("Redis error:", error))
 *     .connect()
 * );
 * ```
 */
export function redisStorage(
  client:
    | RedisLikeClient
    | (() => RedisLikeClient | PromiseLike<RedisLikeClient>),
  options?: RedisStorageOptions
): McpUseStorage {
  const prefix = validateStoragePrefix(options?.prefix, "redisStorage");
  let connecting: Promise<RedisLikeClient> | undefined;
  const connect = (): Promise<RedisLikeClient> => {
    connecting ??= Promise.resolve()
      .then(() => (typeof client === "function" ? client() : client))
      .then((connected) => {
        redisCommand(connected);
        return connected;
      })
      .catch((error: unknown) => {
        connecting = undefined;
        throw error;
      });
    return connecting;
  };
  if (typeof client !== "function") redisCommand(client);
  const command: RedisCommand = async (args) =>
    redisCommand(await connect())(args);
  const subscriberOption = options?.subscriber;
  const signal =
    subscriberOption === false
      ? undefined
      : redisSignal(command, async () => {
          if (subscriberOption !== undefined) {
            if (typeof subscriberOption !== "function") return subscriberOption;
            const open = subscriberOption as () => Promise<RedisSubscriberLike>;
            return open();
          }
          const base = (await connect()) as {
            duplicate?: () => unknown;
          };
          if (typeof base.duplicate !== "function") {
            throw new TypeError(
              "redisStorage signal needs client.duplicate() or the subscriber option; pass subscriber: false to poll instead"
            );
          }
          const duplicate = base.duplicate() as {
            connect?: () => Promise<unknown>;
            isOpen?: boolean;
          };
          // node-redis duplicates start disconnected; ioredis ones connect.
          if (duplicate.isOpen === false && duplicate.connect) {
            await duplicate.connect();
          }
          return duplicate;
        });
  return applyStoragePrefix(
    redisFamilyStorage({
      kind: "redis",
      command,
      pipeline: async (commands) => {
        const connected = (await connect()) as {
          pipeline?: () => {
            call(name: string, ...args: string[]): unknown;
            exec(): Promise<Array<[Error | null, unknown]> | null>;
          };
        };
        if (typeof connected.pipeline === "function") {
          // ioredis: one ordered round trip. On Redis Cluster a pipeline
          // must stay in one slot; otherwise the ops run one by one.
          try {
            const pipeline = connected.pipeline();
            for (const [name, ...args] of commands) {
              pipeline.call(String(name), ...args.map(String));
            }
            const replies = await pipeline.exec();
            if (replies) {
              return replies.map(([error, reply]) => error ?? reply);
            }
          } catch {
            // fall through
          }
          const replies: unknown[] = [];
          for (const args of commands) {
            replies.push(
              await command(args).catch((error: unknown) => error as Error)
            );
          }
          return replies;
        }
        // node-redis pipelines commands sent in the same tick, in order.
        return Promise.all(
          commands.map((args) =>
            command(args).catch((error: unknown) => error as Error)
          )
        );
      },
      ...(signal && { signal }),
    }),
    prefix
  );
}

/** @internal Sends one Redis command and resolves with its reply. */
export type RedisCommand = (args: (string | number)[]) => Promise<unknown>;

function redisCommand(client: RedisLikeClient): RedisCommand {
  if (client !== null && typeof client === "object") {
    // ioredis clients also have a `sendCommand`, which takes a Command
    // object, so `call` is checked first.
    if (typeof (client as IORedisLikeClient).call === "function") {
      const redis = client as IORedisLikeClient;
      return ([name, ...args]) => redis.call(String(name), ...args.map(String));
    }
    if (typeof (client as NodeRedisLikeClient).sendCommand === "function") {
      const redis = client as NodeRedisLikeClient;
      return (args) => redis.sendCommand(args.map(String));
    }
  }
  throw new TypeError("redisStorage requires a node-redis or ioredis client");
}

function redisSignal(
  command: RedisCommand,
  openSubscriber: () => Promise<RedisSubscriberLike>
): StorageSignal {
  let subscriber: Promise<RedisSubscriberLike> | undefined;
  const listeners = new Map<string, Set<(message: string) => void>>();
  const deliver = (channel: unknown, message: unknown) => {
    for (const listener of [
      ...(listeners.get(asString(channel) ?? "") ?? []),
    ]) {
      try {
        listener(asString(message) ?? "");
      } catch {
        // Lossy signal: a failing listener does not affect others.
      }
    }
  };
  const isIORedis = (sub: RedisSubscriberLike) =>
    typeof (sub as { call?: unknown }).call === "function";
  const getSubscriber = () => {
    subscriber ??= openSubscriber()
      .then((sub) => {
        if (isIORedis(sub)) {
          (
            sub as { on(event: string, fn: (...a: unknown[]) => void): void }
          ).on("message", (channel, message) => deliver(channel, message));
        }
        return sub;
      })
      .catch((error: unknown) => {
        subscriber = undefined;
        throw error;
      });
    return subscriber;
  };
  return {
    publish: async (channel, message) => {
      await command(["PUBLISH", channel, message]);
    },
    subscribe: async (channel, onMessage) => {
      const sub = (await getSubscriber()) as {
        subscribe(channel: string, listener?: unknown): Promise<unknown>;
        unsubscribe(channel: string, listener?: unknown): Promise<unknown>;
      };
      let set = listeners.get(channel);
      const wrapped = (message: string) => onMessage(message);
      if (!set) {
        set = new Set();
        listeners.set(channel, set);
        set.add(wrapped);
        if (isIORedis(sub)) {
          await sub.subscribe(channel);
        } else {
          await sub.subscribe(channel, (message: unknown) =>
            deliver(channel, message)
          );
        }
      } else {
        set.add(wrapped);
      }
      return async () => {
        const current = listeners.get(channel);
        if (!current?.delete(wrapped) || current.size > 0) return;
        listeners.delete(channel);
        await sub.unsubscribe(channel).catch(() => undefined);
      };
    },
  };
}

/** @internal The connection a Redis-family store sends commands over. */
export interface RedisFamilyTransport {
  /** Adapter name reported as `kind`. */
  kind: string;
  /** Sends one command. */
  command: RedisCommand;
  /**
   * Sends several commands in one round trip; each result is the reply or
   * an `Error`.
   */
  pipeline: (commands: (string | number)[][]) => Promise<unknown[]>;
  /** Pub/sub, when the transport can subscribe. */
  signal?: StorageSignal;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string"
    ? value
    : value instanceof Uint8Array
      ? new TextDecoder().decode(value)
      : typeof value === "number"
        ? String(value)
        : undefined;
}

const OAUTH_PLAIN = (value: string | undefined): string | undefined => {
  // Values written through `write` carry a version envelope; strip it so
  // `get` and `take` see the value on either path.
  if (value === undefined || value.charCodeAt(0) !== 0) return value;
  const bar = value.indexOf("|", 1);
  return bar === -1 ? value : value.slice(bar + 1);
};

async function sha1(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(text)
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const shas = new Map<string, Promise<string>>();

/** A call reduced to EVAL arguments plus a decoder of its reply. */
interface Call<T> {
  script: string;
  keys: string[];
  args: (string | number)[];
  decode: (reply: unknown) => T;
}

function scoreBound(value: number | undefined, fallback: string): string {
  if (value === undefined) return fallback;
  return value === Infinity
    ? "+inf"
    : value === -Infinity
      ? "-inf"
      : String(value);
}

function seqOf(id: unknown): number {
  return Number((asString(id) ?? "0-0").split("-")[0]);
}

/**
 * @internal The full `McpUseStorage` over raw Redis commands and the
 * shared Lua scripts; used by {@link redisStorage} and `upstashStorage`.
 */
export function redisFamilyStorage(
  transport: RedisFamilyTransport
): McpUseStorage {
  const { command } = transport;
  const evalCall = async <T>(call: Call<T>): Promise<T> => {
    let sha = shas.get(call.script);
    if (!sha) {
      sha = sha1(call.script);
      shas.set(call.script, sha);
    }
    const tail = [call.keys.length, ...call.keys, ...call.args];
    try {
      return call.decode(await command(["EVALSHA", await sha, ...tail]));
    } catch (error) {
      if (!/NOSCRIPT/i.test(String((error as Error)?.message ?? error))) {
        throw error;
      }
      return call.decode(await command(["EVAL", call.script, ...tail]));
    }
  };

  const readCall = (key: string): Call<Versioned | undefined> => ({
    script: READ,
    keys: [key],
    args: [],
    decode: (reply) => {
      if (!Array.isArray(reply)) return undefined;
      return {
        value: asString(reply[0]) ?? "",
        version: asString(reply[1]) ?? "",
      };
    },
  });
  const writeCall = (
    key: string,
    value: string,
    ifVersion: string | null | undefined,
    ttlMs: number | undefined
  ): Call<string | false> => ({
    script: WRITE,
    keys: [key],
    args: [
      value,
      ifVersion === null
        ? "absent"
        : ifVersion === undefined
          ? "any"
          : "version",
      ifVersion ?? "",
      ttlMs === undefined ? "" : Math.max(1, Math.ceil(ttlMs)),
    ],
    decode: (reply) =>
      reply == null || reply === false ? false : asString(reply)!,
  });
  const removeCall = (key: string, ifVersion?: string): Call<boolean> => ({
    script: REMOVE,
    keys: [key],
    args: [ifVersion ?? ""],
    decode: (reply) => Number(reply) === 1,
  });
  const rangeCall = (
    index: string,
    query: { min?: number; max?: number; after?: string; limit: number }
  ): Call<IndexRangePage> => {
    let min = query.min;
    let cursor: [number, string] | undefined;
    if (query.after !== undefined) {
      cursor = JSON.parse(query.after) as [number, string];
      if (min === undefined || cursor[0] > min) min = cursor[0];
    }
    const limit = Math.max(0, query.limit);
    return {
      script: INDEX_RANGE,
      keys: [index],
      args: [
        scoreBound(min, "-inf"),
        scoreBound(query.max, "+inf"),
        limit,
        cursor ? String(cursor[0]) : "",
        cursor ? cursor[1] : "",
      ],
      decode: (reply) => {
        const flat = (reply as unknown[]) ?? [];
        const all = [];
        for (let i = 0; i < flat.length; i += 2) {
          all.push({
            member: asString(flat[i]) ?? "",
            score: Number(asString(flat[i + 1])),
          });
        }
        const items = all.slice(0, limit);
        const last = items[items.length - 1];
        return all.length > limit && last
          ? { items, next: JSON.stringify([last.score, last.member]) }
          : { items };
      },
    };
  };

  const toCall = (op: StorageOp): Call<unknown> | (string | number)[] => {
    switch (op.op) {
      case "read":
        return readCall(op.key);
      case "write":
        return writeCall(op.key, op.value, op.ifVersion, op.ttlMs);
      case "remove":
        return removeCall(op.key, op.ifVersion);
      case "indexAdd":
        return op.onlyIfAbsent
          ? ["ZADD", op.index, "NX", op.score, op.member]
          : ["ZADD", op.index, op.score, op.member];
      case "indexRemove":
        return ["ZREM", op.index, op.member];
      case "indexRange":
        return rangeCall(op.index, op);
      default:
        throw new TypeError("unknown storage op");
    }
  };

  const store: McpUseStorage = {
    kind: transport.kind,
    durable: true,
    shared: true,
    capabilities: { signal: transport.signal !== undefined, batch: true },
    get: async (key) => OAUTH_PLAIN(asString(await command(["GET", key]))),
    set: async (key, value, ttlSeconds) => {
      await command(["SET", key, value, "EX", ttlSeconds]);
    },
    delete: async (key) => {
      await command(["DEL", key]);
    },
    take: async (key) => OAUTH_PLAIN(asString(await command(["GETDEL", key]))),
    add: async (key, value, ttlSeconds) =>
      (await command(["SET", key, value, "NX", "EX", ttlSeconds])) !== null,
    read: (key) => evalCall(readCall(key)),
    readMany: (keys) => Promise.all(keys.map((key) => evalCall(readCall(key)))),
    write: (key, value, options) =>
      evalCall(writeCall(key, value, options?.ifVersion, options?.ttlMs)),
    remove: (key, options) => evalCall(removeCall(key, options?.ifVersion)),
    incr: (key, options) =>
      evalCall({
        script: INCR,
        keys: [key],
        args: [options.by ?? 1, Math.max(1, Math.ceil(options.ttlMs))],
        decode: (reply) => Number(reply),
      }),
    indexAdd: async (index, member, score, options) => {
      await command(
        options?.onlyIfAbsent
          ? ["ZADD", index, "NX", score, member]
          : ["ZADD", index, score, member]
      );
    },
    indexRemove: async (index, member) => {
      await command(["ZREM", index, member]);
    },
    indexRange: (index, query) => evalCall(rangeCall(index, query)),
    indexCount: async (index, query) =>
      Number(
        await command([
          "ZCOUNT",
          index,
          scoreBound(query?.min, "-inf"),
          scoreBound(query?.max, "+inf"),
        ])
      ),
    logAppend: (stream, value, options) => {
      const head = `${stream}|head`;
      return evalCall<LogAppendResult>({
        script: LOG_APPEND,
        keys: [
          stream,
          head,
          options.dedupe?.key ?? head,
          options.mark?.index ?? head,
        ],
        args: [
          value,
          Math.max(1, Math.floor(options.maxEvents)),
          options.dedupe ? Math.max(1, Math.ceil(options.dedupe.ttlMs)) : "",
          options.mark?.member ?? "",
          options.mark?.score ?? 0,
          options.mark && options.notify !== undefined && transport.signal
            ? options.notify
            : "",
          randomEpoch(),
        ],
        decode: (reply) => {
          const r = reply as unknown[];
          if (Number(r[0]) === 1) {
            const seq = Number(asString(r[1]));
            return { duplicate: true, seq: Number.isFinite(seq) ? seq : null };
          }
          return {
            duplicate: false,
            seq: Number(r[1]),
            epoch: asString(r[2]) ?? "",
          };
        },
      });
    },
    logRange: (stream, options) =>
      evalCall<LogRangeResult>({
        script: LOG_RANGE,
        keys: [stream, `${stream}|head`],
        args: [
          options.after === null ? "" : Math.floor(options.after),
          Math.max(0, options.limit),
        ],
        decode: (reply) => {
          const r = reply as unknown[];
          const epoch = asString(r[0]) ?? null;
          const entries = [];
          for (let i = 3; i < r.length; i += 2) {
            entries.push({ seq: seqOf(r[i]), value: asString(r[i + 1]) ?? "" });
          }
          return {
            entries,
            epoch: epoch === "" ? null : epoch,
            first: seqOf(r[2]),
            head: Number(r[1]),
          };
        },
      }),
    logTrim: async (stream, options) =>
      Number(
        await command([
          "XTRIM",
          stream,
          "MINID",
          `${Math.floor(options.before)}-0`,
        ])
      ),
    logDelete: async (stream) => {
      await command(["DEL", stream, `${stream}|head`]);
    },
    batch: async (ops) => {
      const calls = ops.map(toCall);
      const replies = await transport.pipeline(
        calls.map((call) =>
          Array.isArray(call)
            ? call
            : [
                "EVAL",
                call.script,
                call.keys.length,
                ...call.keys,
                ...call.args,
              ]
        )
      );
      return calls.map((call, i) => {
        const reply = replies[i];
        if (reply instanceof Error) return reply;
        if (Array.isArray(call)) return undefined;
        try {
          return call.decode(reply);
        } catch (error) {
          return error;
        }
      });
    },
    removePrefix: async (keyPrefix) => {
      const pattern = keyPrefix.replace(/[*?[\]\\]/g, "\\$&") + "*";
      let cursor = "0";
      let removed = 0;
      do {
        const reply = (await command([
          "SCAN",
          cursor,
          "MATCH",
          pattern,
          "COUNT",
          500,
        ])) as [unknown, unknown[]];
        cursor = asString(reply[0]) ?? "0";
        const keys = (reply[1] ?? []).map((key) => asString(key) ?? "");
        // Head hashes are removed with their log and not counted twice.
        const counted = keys.filter((key) => !key.endsWith("|head"));
        if (keys.length > 0) {
          await command(["UNLINK", ...keys]);
          removed += counted.length;
        }
      } while (cursor !== "0");
      // TODO(events): on Redis Cluster SCAN covers one node only; walk every
      // master when the client is a cluster client.
      return removed;
    },
  };
  if (transport.signal) store.signal = transport.signal;
  return store;
}

/**
 * @internal The OAuth key-value operations of a Redis-family store; kept
 * for callers that need only `OAuthProxyStorage`.
 */
export function redisCommandStorage(command: RedisCommand): OAuthProxyStorage {
  const {
    get,
    set,
    delete: del,
    take,
    add,
  } = redisFamilyStorage({
    kind: "redis",
    command,
    pipeline: (commands) => Promise.all(commands.map((args) => command(args))),
  });
  return { get, set, delete: del, take, add };
}
