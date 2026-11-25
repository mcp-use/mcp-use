/**
 * Cloudflare Durable Object storage: the client used by
 * `cloudflareStorage({ durableObject })`, the OAuth-only Durable Object
 * class and `McpUseStorageDurableObject`, which holds OAuth and Events
 * state.
 *
 * @packageDocumentation
 */
import type {
  IndexEntry,
  LogAppendResult,
  McpUseStorage,
  StorageOp,
  Versioned,
} from "../types.js";

/** A Durable Object stub: sends requests to one object. */
interface DurableObjectStubLike {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

/** The subset of a Durable Object namespace binding the adapter uses. */
export interface DurableObjectNamespaceLike {
  /** Derives an object ID from a name. */
  idFromName(name: string): unknown;
  /** Gets a stub for an object ID. */
  get(id: never): {
    /** Sends a request to the object. */
    fetch(input: string, init?: RequestInit): Promise<Response>;
  };
}

/** Methods the Events object answers, one Durable Object call each. */
const _EVENTS_METHODS = [
  "read",
  "readMany",
  "write",
  "remove",
  "incr",
  "indexAdd",
  "indexRemove",
  "indexRange",
  "indexCount",
  "logAppend",
  "logRange",
  "logTrim",
  "logDelete",
  "batch",
  "removePrefix",
] as const;

type EventsMethod = (typeof _EVENTS_METHODS)[number];

async function callObject(
  stub: DurableObjectStubLike,
  url: string,
  body: Record<string, unknown>,
  what: string
): Promise<unknown> {
  const response = await stub.fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `${what} Durable Object returned ${response.status}${text ? `: ${text}` : ""}`
    );
  }
  return ((await response.json()) as { result?: unknown }).result;
}

/**
 * @internal The store behind `cloudflareStorage({ durableObject })`. OAuth
 * keys go to the object named `mcp-use-oauth` with the OAuth layout, so an
 * `OAuthProxyDurableObject` binding keeps working for OAuth. Events state
 * goes to the `McpUseStorageDurableObject` named `mcp-use-storage`, one
 * call per operation (and per batch). Every prefix shares that object, so
 * a store without a prefix sees the keys of prefixed ones, as on every
 * other adapter.
 *
 * @param namespace - Durable Object namespace binding.
 * @returns A store; the caller wraps it with its prefix.
 */
export function durableObjectStorage(
  namespace: DurableObjectNamespaceLike
): McpUseStorage {
  if (
    namespace === null ||
    typeof namespace?.idFromName !== "function" ||
    typeof namespace?.get !== "function"
  ) {
    throw new TypeError(
      "cloudflareStorage durableObject must be a Durable Object namespace binding"
    );
  }
  const oauthStub = namespace.get(
    namespace.idFromName("mcp-use-oauth") as never
  );
  let eventsStub: DurableObjectStubLike | undefined;
  const oauth = (body: Record<string, unknown>) =>
    callObject(oauthStub, "https://oauth-storage/", body, "OAuth storage");
  const events = (method: EventsMethod, args: unknown[]) => {
    eventsStub ??= namespace.get(
      namespace.idFromName("mcp-use-storage") as never
    );
    return callObject(
      eventsStub,
      "https://mcp-use-storage/",
      { method, args },
      "McpUseStorageDurableObject (bind McpUseStorageDurableObject, not OAuthProxyDurableObject, for Events)"
    );
  };
  const storage: McpUseStorage = {
    kind: "durable-object",
    durable: true,
    shared: true,
    capabilities: { signal: false, batch: true },
    get: async (key) => (await oauth({ op: "get", key })) as string | undefined,
    set: async (key, value, ttlSeconds) => {
      await oauth({ op: "set", key, value, ttl: ttlSeconds });
    },
    delete: async (key) => {
      await oauth({ op: "delete", key });
    },
    take: async (key) =>
      (await oauth({ op: "take", key })) as string | undefined,
    add: async (key, value, ttlSeconds) =>
      (await oauth({ op: "add", key, value, ttl: ttlSeconds })) === true,
    read: async (key) =>
      ((await events("read", [key])) ?? undefined) as Versioned | undefined,
    readMany: async (keys) =>
      ((await events("readMany", [keys])) as (Versioned | null)[]).map(
        (entry) => entry ?? undefined
      ),
    write: async (key, value, options) =>
      (await events("write", [key, value, options ?? {}])) as string | false,
    remove: async (key, options) =>
      (await events("remove", [key, options ?? {}])) as boolean,
    incr: async (key, options) =>
      (await events("incr", [key, options])) as number,
    indexAdd: async (index, member, score, options) => {
      await events("indexAdd", [index, member, score, options ?? {}]);
    },
    indexRemove: async (index, member) => {
      await events("indexRemove", [index, member]);
    },
    indexRange: async (index, query) =>
      (await events("indexRange", [index, query])) as {
        items: IndexEntry[];
        next?: string;
      },
    indexCount: async (index, query) =>
      (await events("indexCount", [index, query ?? {}])) as number,
    logAppend: async (stream, value, options) =>
      (await events("logAppend", [stream, value, options])) as LogAppendResult,
    logRange: async (stream, options) =>
      (await events("logRange", [stream, options])) as Awaited<
        ReturnType<McpUseStorage["logRange"]>
      >,
    logTrim: async (stream, options) =>
      (await events("logTrim", [stream, options])) as number,
    logDelete: async (stream) => {
      await events("logDelete", [stream]);
    },
    batch: async (ops: ReadonlyArray<StorageOp>) => {
      const results = (await events("batch", [ops])) as Array<
        { ok: unknown } | { error: string }
      >;
      return results.map((result) =>
        "error" in result ? new Error(result.error) : (result.ok ?? undefined)
      );
    },
    removePrefix: async (keyPrefix) =>
      (await events("removePrefix", [keyPrefix])) as number,
  };
  return storage;
}

/** The subset of Durable Object storage that {@link OAuthProxyDurableObject} uses. */
export interface DurableObjectStorageLike {
  /** Reads a value. */
  get<T>(key: string): Promise<T | undefined>;
  /** Writes a value. */
  put(key: string, value: unknown): Promise<void>;
  /** Removes a value. */
  delete(key: string): Promise<boolean>;
  /**
   * Lists values in key order.
   *
   * @param options - `limit` caps how many entries come back; `startAfter`
   * lists only keys that sort after this key.
   */
  list<T>(options?: {
    limit?: number;
    startAfter?: string;
  }): Promise<Map<string, T>>;
}

// Where OAuthProxyDurableObject keeps its sweep position: outside the
// `mcp-use:oauth:` keys that oauthProxy stores.
const SWEEP_CURSOR_KEY = "mcp-use-sweep-cursor";

/**
 * Durable Object class for `cloudflareStorage({ durableObject })`. Export it
 * from the Worker and bind it in `wrangler.jsonc`:
 *
 * ```ts
 * export { OAuthProxyDurableObject } from "mcp-use/oauth/storage";
 * // wrangler: durable_objects.bindings = [{ name: "OAUTH", class_name: "OAuthProxyDurableObject" }]
 * // plus a migration with new_sqlite_classes = ["OAuthProxyDurableObject"]
 * ```
 */
export class OAuthProxyDurableObject {
  readonly #storage: DurableObjectStorageLike;
  #writes = 0;

  /**
   * Called by the Workers runtime.
   *
   * @param state - Durable Object state with its storage.
   * @param _env - Worker environment (unused).
   */
  constructor(state: { storage: DurableObjectStorageLike }, _env?: unknown) {
    this.#storage = state.storage;
  }

  /**
   * Handles one storage operation from `cloudflareStorage`.
   *
   * @param request - JSON body with the operation.
   * @returns JSON body with the result.
   */
  async fetch(request: Request): Promise<Response> {
    const body = (await request.json()) as {
      op?: string;
      key?: string;
      value?: string;
      ttl?: number;
    };
    if (typeof body.key !== "string") {
      return new Response("key required", { status: 400 });
    }
    const key = body.key;
    const read = async (): Promise<string | undefined> => {
      const entry = await this.#storage.get<{
        value: string;
        expiresAt: number;
      }>(key);
      if (entry === undefined) return undefined;
      if (entry.expiresAt <= Date.now()) {
        await this.#storage.delete(key);
        return undefined;
      }
      return entry.value;
    };
    const write = async (): Promise<void> => {
      await this.#storage.put(key, {
        value: String(body.value),
        expiresAt: Date.now() + Number(body.ttl) * 1000,
      });
      if (++this.#writes % 200 === 0) await this.#sweep();
    };
    let result: unknown;
    switch (body.op) {
      case "get":
        result = await read();
        break;
      case "set":
        await write();
        break;
      case "delete":
        await this.#storage.delete(key);
        break;
      case "take":
        result = await read();
        await this.#storage.delete(key);
        break;
      case "add":
        result = (await read()) === undefined;
        if (result === true) await write();
        break;
      default:
        return new Response("unknown op", { status: 400 });
    }
    return Response.json({ result });
  }

  // Each sweep checks the next page of keys, so expired entries behind
  // 1,000 live ones are reached too. The position is stored, so it survives
  // the object being evicted between sweeps.
  async #sweep(): Promise<void> {
    const limit = 1000;
    const cursor = await this.#storage.get<string>(SWEEP_CURSOR_KEY);
    const entries = await this.#storage.list<{ expiresAt: number }>({
      limit,
      ...(cursor !== undefined && { startAfter: cursor }),
    });
    const now = Date.now();
    let last: string | undefined;
    for (const [key, entry] of entries) {
      last = key;
      if (key === SWEEP_CURSOR_KEY) continue;
      if (entry.expiresAt <= now) await this.#storage.delete(key);
    }
    if (entries.size < limit || last === undefined) {
      await this.#storage.delete(SWEEP_CURSOR_KEY);
    } else {
      await this.#storage.put(SWEEP_CURSOR_KEY, last);
    }
  }
}

/** The Durable Object storage API that {@link McpUseStorageDurableObject} uses. */
export interface McpUseDurableObjectStorageLike {
  /** Reads one value. */
  get<T>(key: string): Promise<T | undefined>;
  /** Reads several values; absent keys are missing from the map. */
  get<T>(keys: string[]): Promise<Map<string, T>>;
  /** Writes one value. */
  put(key: string, value: unknown): Promise<void>;
  /** Writes several values. */
  put(entries: Record<string, unknown>): Promise<void>;
  /** Removes one value. */
  delete(key: string): Promise<boolean>;
  /** Removes up to 128 values and returns how many existed. */
  delete(keys: string[]): Promise<number>;
  /**
   * Lists values in key order.
   *
   * @param options - Key range (`start` inclusive, `startAfter` and `end`
   * exclusive), `prefix`, `limit` and `reverse`.
   */
  list<T>(options?: {
    start?: string;
    startAfter?: string;
    end?: string;
    prefix?: string;
    limit?: number;
    reverse?: boolean;
  }): Promise<Map<string, T>>;
}

interface KvRecord {
  v: string;
  ver: string;
  exp?: number | undefined;
}

interface HeadRecord {
  epoch: string;
  seq: number;
}

const SEP = "\u0000";
const DELETE_CHUNK = 128;
const LIST_PAGE = 1000;

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A float64 as 16 hex digits whose string order is numeric order. */
function sortableScore(score: number): string {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, score === 0 ? 0 : score);
  let bits = view.getBigUint64(0);
  bits =
    bits & 0x8000000000000000n
      ? ~bits & 0xffffffffffffffffn
      : bits | 0x8000000000000000n;
  return bits.toString(16).padStart(16, "0");
}

const seqKey = (seq: number) => seq.toString(16).padStart(16, "0");

/**
 * Durable Object class for Events (and OAuth) state through
 * `cloudflareStorage({ durableObject })`. Operations on one object run one
 * at a time, so each, `logAppend` included, is atomic. Export it from the
 * Worker and bind it in `wrangler.jsonc`:
 *
 * ```ts
 * export { McpUseStorageDurableObject } from "mcp-use/storage";
 * // wrangler: durable_objects.bindings = [{ name: "MCP_USE_STORAGE", class_name: "McpUseStorageDurableObject" }]
 * // plus a migration with new_sqlite_classes = ["McpUseStorageDurableObject"]
 * ```
 *
 * Layout: values `k:<key>`, index entries `x:<index>\0<score>\0<member>`
 * with a reverse map `r:<index>\0<member>`, log heads `h:<stream>` and
 * entries `l:<stream>\0<seq>`. It has no wake signal; readers poll the log.
 */
export class McpUseStorageDurableObject {
  readonly #storage: McpUseDurableObjectStorageLike;
  #queue: Promise<unknown> = Promise.resolve();
  #writes = 0;

  /**
   * Called by the Workers runtime.
   *
   * @param state - Durable Object state with its storage.
   * @param _env - Worker environment (unused).
   */
  constructor(
    state: { storage: McpUseDurableObjectStorageLike },
    _env?: unknown
  ) {
    this.#storage = state.storage;
  }

  /**
   * Handles one storage operation from `cloudflareStorage`: an Events call
   * `{ method, args }` or an OAuth call `{ op, key, value?, ttl? }`.
   *
   * @param request - JSON body with the operation.
   * @returns JSON body `{ result }`, or status 400 with the reason.
   */
  async fetch(request: Request): Promise<Response> {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return new Response("JSON body required", { status: 400 });
    }
    const task = () =>
      Array.isArray(body["args"])
        ? this.#call(String(body["method"]), body["args"] as unknown[])
        : this.#oauth(body);
    const result = this.#queue.then(task, task);
    this.#queue = result.catch(() => undefined);
    try {
      return Response.json({ result: await result });
    } catch (error) {
      return new Response(
        error instanceof Error ? error.message : String(error),
        { status: 400 }
      );
    }
  }

  async #oauth(body: Record<string, unknown>): Promise<unknown> {
    const key = body["key"];
    if (typeof key !== "string") throw new Error("key required");
    const k = `o:${key}`;
    const ttlMs = Number(body["ttl"]) * 1000;
    switch (body["op"]) {
      case "get":
        return (await this.#live(k))?.v;
      case "set":
        await this.#put(k, String(body["value"]), ttlMs);
        return undefined;
      case "delete":
        await this.#storage.delete(k);
        return undefined;
      case "take": {
        const value = (await this.#live(k))?.v;
        await this.#storage.delete(k);
        return value;
      }
      case "add":
        if (await this.#live(k)) return false;
        await this.#put(k, String(body["value"]), ttlMs);
        return true;
      default:
        throw new Error("unknown op");
    }
  }

  async #call(method: string, args: unknown[]): Promise<unknown> {
    const a = args as [never, never, never, never];
    switch (method) {
      case "read":
        return this.#read(a[0]);
      case "readMany":
        return Promise.all(
          (a[0] as string[]).map(async (key) => (await this.#read(key)) ?? null)
        );
      case "write":
        return this.#write(a[0], a[1], a[2]);
      case "remove":
        return this.#remove(a[0], a[1]);
      case "incr":
        return this.#incr(a[0], a[1]);
      case "indexAdd":
        return this.#indexAdd(a[0], a[1], a[2], a[3]);
      case "indexRemove":
        return this.#indexRemove(a[0], a[1]);
      case "indexRange":
        return this.#indexRange(a[0], a[1]);
      case "indexCount":
        return this.#indexCount(a[0], a[1]);
      case "logAppend":
        return this.#logAppend(a[0], a[1], a[2]);
      case "logRange":
        return this.#logRange(a[0], a[1]);
      case "logTrim":
        return this.#logTrim(a[0], a[1]);
      case "logDelete":
        return this.#logDelete(a[0]);
      case "batch":
        return this.#batch(a[0]);
      case "removePrefix":
        return this.#removePrefix(a[0]);
      default:
        throw new Error(`unknown method ${JSON.stringify(method)}`);
    }
  }

  async #live(k: string): Promise<KvRecord | undefined> {
    const entry = await this.#storage.get<KvRecord>(k);
    if (entry === undefined) return undefined;
    if (entry.exp !== undefined && entry.exp <= Date.now()) {
      await this.#storage.delete(k);
      return undefined;
    }
    return entry;
  }

  async #put(k: string, value: string, ttlMs?: number): Promise<string> {
    const ver = randomHex(8);
    await this.#storage.put(k, {
      v: value,
      ver,
      ...(ttlMs !== undefined && { exp: Date.now() + ttlMs }),
    } satisfies KvRecord);
    if (ttlMs !== undefined && ++this.#writes % 200 === 0) await this.#sweep();
    return ver;
  }

  async #read(key: string): Promise<Versioned | undefined> {
    const entry = await this.#live(`k:${key}`);
    return entry && { value: entry.v, version: entry.ver };
  }

  async #write(
    key: string,
    value: string,
    options: { ifVersion?: string | null; ttlMs?: number } = {}
  ): Promise<string | false> {
    const k = `k:${key}`;
    if (options.ifVersion !== undefined) {
      const current = await this.#live(k);
      if (
        options.ifVersion === null
          ? current
          : current?.ver !== options.ifVersion
      ) {
        return false;
      }
    }
    return this.#put(k, value, options.ttlMs);
  }

  async #remove(key: string, options: { ifVersion?: string } = {}) {
    const k = `k:${key}`;
    const current = await this.#live(k);
    if (!current) return false;
    if (options.ifVersion !== undefined && current.ver !== options.ifVersion) {
      return false;
    }
    await this.#storage.delete(k);
    return true;
  }

  async #incr(key: string, options: { ttlMs: number; by?: number }) {
    const k = `k:${key}`;
    const current = await this.#live(k);
    const next = Number(current?.v ?? 0) + (options.by ?? 1);
    await this.#storage.put(k, {
      v: String(next),
      ver: randomHex(8),
      exp: current ? current.exp : Date.now() + options.ttlMs,
    } satisfies KvRecord);
    return next;
  }

  async #indexAdd(
    index: string,
    member: string,
    score: number,
    options: { onlyIfAbsent?: boolean } = {}
  ): Promise<void> {
    const reverse = `r:${index}${SEP}${member}`;
    const existing = await this.#storage.get<number>(reverse);
    if (existing !== undefined) {
      if (options.onlyIfAbsent) return;
      await this.#storage.delete(
        `x:${index}${SEP}${sortableScore(existing)}${SEP}${member}`
      );
    }
    await this.#storage.put({
      [reverse]: score,
      [`x:${index}${SEP}${sortableScore(score)}${SEP}${member}`]: score,
    });
  }

  async #indexRemove(index: string, member: string): Promise<void> {
    const reverse = `r:${index}${SEP}${member}`;
    const existing = await this.#storage.get<number>(reverse);
    if (existing === undefined) return;
    await this.#storage.delete([
      reverse,
      `x:${index}${SEP}${sortableScore(existing)}${SEP}${member}`,
    ]);
  }

  #indexBounds(index: string, query: { min?: number; max?: number }) {
    const base = `x:${index}${SEP}`;
    return {
      base,
      start: query.min === undefined ? base : base + sortableScore(query.min),
      // SEP sorts below every hex digit, so "\u0001" ends a score or the index.
      end:
        query.max === undefined
          ? `x:${index}\u0001`
          : `${base}${sortableScore(query.max)}\u0001`,
    };
  }

  async #indexRange(
    index: string,
    query: { min?: number; max?: number; after?: string; limit: number }
  ) {
    const { base, start, end } = this.#indexBounds(index, query);
    const after =
      query.after !== undefined &&
      query.after.startsWith(base) &&
      query.after >= start
        ? query.after
        : undefined;
    const page = await this.#storage.list<number>({
      ...(after === undefined ? { start } : { startAfter: after }),
      end,
      limit: query.limit + 1,
    });
    const items: IndexEntry[] = [];
    let last: string | undefined;
    for (const [key, score] of page) {
      if (items.length === query.limit) break;
      items.push({ member: key.slice(base.length + 17), score });
      last = key;
    }
    return page.size > query.limit && last !== undefined
      ? { items, next: last }
      : { items };
  }

  async #indexCount(index: string, query: { min?: number; max?: number } = {}) {
    const { start, end } = this.#indexBounds(index, query);
    let count = 0;
    let cursor: string | undefined;
    for (;;) {
      const page = await this.#storage.list({
        ...(cursor === undefined ? { start } : { startAfter: cursor }),
        end,
        limit: LIST_PAGE,
      });
      count += page.size;
      if (page.size < LIST_PAGE) return count;
      cursor = [...page.keys()].pop();
    }
  }

  async #deleteRange(options: {
    start?: string;
    end?: string;
    prefix?: string;
  }): Promise<string[]> {
    const removed: string[] = [];
    for (;;) {
      const page = await this.#storage.list({ ...options, limit: LIST_PAGE });
      const keys = [...page.keys()];
      for (let i = 0; i < keys.length; i += DELETE_CHUNK) {
        await this.#storage.delete(keys.slice(i, i + DELETE_CHUNK));
      }
      removed.push(...keys);
      if (keys.length < LIST_PAGE) return removed;
    }
  }

  async #logAppend(
    stream: string,
    value: string,
    options: {
      maxEvents: number;
      dedupe?: { key: string; ttlMs: number };
      mark?: { index: string; member: string; score: number };
      notify?: string;
    }
  ): Promise<LogAppendResult> {
    if (options.dedupe) {
      const existing = await this.#live(`k:${options.dedupe.key}`);
      if (existing) {
        return {
          duplicate: true,
          seq: /^\d+$/.test(existing.v) ? Number(existing.v) : null,
        };
      }
    }
    const headKey = `h:${stream}`;
    const entries = `l:${stream}${SEP}`;
    let head = await this.#storage.get<HeadRecord>(headKey);
    if (!head) {
      await this.#deleteRange({ prefix: entries });
      head = { epoch: randomHex(12), seq: 0 };
    }
    const seq = head.seq + 1;
    await this.#storage.put({
      [headKey]: { epoch: head.epoch, seq } satisfies HeadRecord,
      [entries + seqKey(seq)]: value,
    });
    const keep = Math.max(0, Math.trunc(options.maxEvents));
    if (seq - keep >= 1) {
      await this.#deleteRange({
        start: entries,
        end: entries + seqKey(seq - keep + 1),
      });
    }
    if (options.dedupe) {
      await this.#put(
        `k:${options.dedupe.key}`,
        String(seq),
        options.dedupe.ttlMs
      );
    }
    if (options.mark) {
      await this.#indexAdd(
        options.mark.index,
        options.mark.member,
        options.mark.score,
        {
          onlyIfAbsent: true,
        }
      );
    }
    return { duplicate: false, seq, epoch: head.epoch };
  }

  async #logRange(
    stream: string,
    options: { after: number | null; limit: number }
  ) {
    const head = await this.#storage.get<HeadRecord>(`h:${stream}`);
    if (!head) return { entries: [], epoch: null, first: 1, head: 0 };
    const entries = `l:${stream}${SEP}`;
    const oldest = await this.#storage.list<string>({
      prefix: entries,
      limit: 1,
    });
    const firstKey = [...oldest.keys()][0];
    const first =
      firstKey === undefined
        ? head.seq + 1
        : parseInt(firstKey.slice(entries.length), 16);
    const result: Array<{ seq: number; value: string }> = [];
    if (options.limit > 0) {
      const after = options.after ?? 0;
      const page = await this.#storage.list<string>({
        start: entries + seqKey(after + 1),
        end: `l:${stream}\u0001`,
        limit: options.limit,
      });
      for (const [key, value] of page) {
        result.push({ seq: parseInt(key.slice(entries.length), 16), value });
      }
    }
    return { entries: result, epoch: head.epoch, first, head: head.seq };
  }

  async #logTrim(stream: string, options: { before: number }) {
    const entries = `l:${stream}${SEP}`;
    if (options.before <= 1) return 0;
    return (
      await this.#deleteRange({
        start: entries,
        end: entries + seqKey(options.before),
      })
    ).length;
  }

  async #logDelete(stream: string): Promise<void> {
    await this.#storage.delete(`h:${stream}`);
    await this.#deleteRange({ prefix: `l:${stream}${SEP}` });
  }

  async #batch(ops: StorageOp[]) {
    const results: Array<{ ok: unknown } | { error: string }> = [];
    for (const op of ops) {
      try {
        results.push({ ok: await this.#op(op) });
      } catch (error) {
        results.push({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return results;
  }

  #op(op: StorageOp): Promise<unknown> {
    switch (op.op) {
      case "read":
        return this.#read(op.key);
      case "write":
        return this.#write(op.key, op.value, {
          ...(op.ifVersion !== undefined && { ifVersion: op.ifVersion }),
          ...(op.ttlMs !== undefined && { ttlMs: op.ttlMs }),
        });
      case "remove":
        return this.#remove(
          op.key,
          op.ifVersion === undefined ? {} : { ifVersion: op.ifVersion }
        );
      case "indexAdd":
        return this.#indexAdd(op.index, op.member, op.score, {
          onlyIfAbsent: op.onlyIfAbsent === true,
        });
      case "indexRemove":
        return this.#indexRemove(op.index, op.member);
      case "indexRange":
        return this.#indexRange(op.index, {
          ...(op.min !== undefined && { min: op.min }),
          ...(op.max !== undefined && { max: op.max }),
          limit: op.limit,
        });
      default:
        return Promise.reject(new Error("unknown storage op"));
    }
  }

  async #removePrefix(prefix: string): Promise<number> {
    let removed = 0;
    for (const key of await this.#deleteRange({ prefix: `k:${prefix}` })) {
      if (key) removed++;
    }
    const indexes = new Set(
      (await this.#deleteRange({ prefix: `r:${prefix}` })).map((key) =>
        key.slice(2, key.lastIndexOf(SEP))
      )
    );
    await this.#deleteRange({ prefix: `x:${prefix}` });
    const streams = new Set(
      (await this.#deleteRange({ prefix: `h:${prefix}` })).map((key) =>
        key.slice(2)
      )
    );
    for (const key of await this.#deleteRange({ prefix: `l:${prefix}` })) {
      streams.add(key.slice(2, key.lastIndexOf(SEP)));
    }
    return removed + indexes.size + streams.size;
  }

  // Each sweep checks the next page of values, so expired values behind
  // live ones are reached too; the position is kept in memory only.
  #sweepCursor: string | undefined;

  async #sweep(): Promise<void> {
    const page = await this.#storage.list<KvRecord>({
      ...(this.#sweepCursor === undefined
        ? { start: "k:" }
        : { startAfter: this.#sweepCursor }),
      end: "k;",
      limit: LIST_PAGE,
    });
    const now = Date.now();
    const expired: string[] = [];
    for (const [key, entry] of page) {
      if (entry.exp !== undefined && entry.exp <= now) expired.push(key);
    }
    for (let i = 0; i < expired.length; i += DELETE_CHUNK) {
      await this.#storage.delete(expired.slice(i, i + DELETE_CHUNK));
    }
    this.#sweepCursor =
      page.size < LIST_PAGE ? undefined : [...page.keys()].pop();
  }
}
