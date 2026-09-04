import { describe, expect, it, vi } from "vitest";

import {
  createOAuthProxyStoreEntry,
  inMemoryOAuthStore,
  readOAuthProxyStoreEntry,
  resolveOAuthProxyStore,
  type OAuthProxyStore,
  type OAuthProxyStoreCapabilities,
  type OAuthProxyStoreConsumeResult,
  type OAuthProxyStoreReadResult,
  type OAuthProxyStoreTransaction,
} from "../src/oauth/proxy/store.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const future = () => Date.now() + 60_000;

function bytes(value: string): Uint8Array {
  return encoder.encode(value);
}

function text(value: Uint8Array): string {
  return decoder.decode(value);
}

function consume(store: OAuthProxyStore, key: string) {
  return store.transaction([key], (transaction) => transaction.consume(key));
}

function replace(
  store: OAuthProxyStore,
  key: string,
  payload: Uint8Array,
  expiresAt: number
) {
  const snapshot = Uint8Array.from(payload);
  return store.transaction([key], (transaction) =>
    transaction.replace(key, snapshot, expiresAt)
  );
}

class TestStore implements OAuthProxyStore {
  readonly values = new Map<
    string,
    | { kind: "live"; payload: Uint8Array; expiresAt: number }
    | { kind: "tombstone"; expiresAt: number }
  >();
  lastTransactionKeys: readonly string[] = [];
  #tail = Promise.resolve();

  constructor(readonly capabilities: OAuthProxyStoreCapabilities) {}

  async transaction<T>(
    keys: readonly string[],
    work: (transaction: OAuthProxyStoreTransaction) => T | Promise<T>
  ): Promise<T> {
    const previous = this.#tail;
    let release = (): void => undefined;
    this.#tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const canonical = [...new Set(keys)].sort();
      this.lastTransactionKeys = canonical;
      const declared = new Set(canonical);
      const staged = new Map(
        [...this.values].map(([key, value]) => [
          key,
          value.kind === "live"
            ? { ...value, payload: Uint8Array.from(value.payload) }
            : { ...value },
        ])
      );
      const assertDeclared = (key: string) => {
        if (!declared.has(key)) {
          throw new TypeError(`undeclared key: ${key}`);
        }
      };
      const transaction: OAuthProxyStoreTransaction = {
        async create(key, payload, expiresAt) {
          assertDeclared(key);
          if (staged.has(key)) return { status: "conflict" };
          staged.set(key, {
            kind: "live",
            payload: Uint8Array.from(payload),
            expiresAt,
          });
          return { status: "created" };
        },
        async read(key): Promise<OAuthProxyStoreReadResult> {
          assertDeclared(key);
          const value = staged.get(key);
          if (value === undefined) return { status: "missing" };
          return value.kind === "tombstone"
            ? { status: "replayed" }
            : { status: "found", payload: Uint8Array.from(value.payload) };
        },
        async replace(key, payload, expiresAt) {
          assertDeclared(key);
          const value = staged.get(key);
          if (value === undefined) return { status: "missing" };
          if (value.kind === "tombstone") return { status: "replayed" };
          staged.set(key, {
            kind: "live",
            payload: Uint8Array.from(payload),
            expiresAt,
          });
          return { status: "replaced" };
        },
        async consume(key): Promise<OAuthProxyStoreConsumeResult> {
          assertDeclared(key);
          const value = staged.get(key);
          if (value === undefined) return { status: "missing" };
          if (value.kind === "tombstone") return { status: "replayed" };
          staged.set(key, {
            kind: "tombstone",
            expiresAt: value.expiresAt,
          });
          return {
            status: "consumed",
            payload: Uint8Array.from(value.payload),
          };
        },
      };
      const result = await work(transaction);
      this.values.clear();
      for (const [key, value] of staged) this.values.set(key, value);
      return result;
    } finally {
      release();
    }
  }
}

describe("OAuth proxy store resolution", () => {
  it("creates isolated process-local stores when store is omitted", async () => {
    const first = resolveOAuthProxyStore();
    const second = resolveOAuthProxyStore();

    expect(first.capabilities).toEqual({
      persistence: "process-local",
      secretProtection: "none",
    });
    await expect(
      createOAuthProxyStoreEntry(
        first.store,
        "transaction:a",
        bytes("secret"),
        future()
      )
    ).resolves.toEqual({ status: "created" });
    await expect(
      readOAuthProxyStoreEntry(second.store, "transaction:a")
    ).resolves.toEqual({ status: "missing" });
  });

  it("uses a protected persistent store directly across resolver instances", async () => {
    const persistent = new TestStore({
      persistence: "persistent",
      secretProtection: "store-encrypted",
    });
    const first = resolveOAuthProxyStore({ store: persistent });
    expect(first.store).toBe(persistent);
    await createOAuthProxyStoreEntry(
      first.store,
      "transaction:a",
      bytes("secret"),
      future()
    );

    const afterRestart = resolveOAuthProxyStore({ store: persistent });
    const result = await readOAuthProxyStoreEntry(
      afterRestart.store,
      "transaction:a"
    );
    expect(result.status).toBe("found");
    if (result.status === "found") expect(text(result.payload)).toBe("secret");
  });

  it("rejects persistent stores that do not encrypt secrets", () => {
    expect(() =>
      resolveOAuthProxyStore({
        store: new TestStore({
          persistence: "persistent",
          secretProtection: "none",
        }),
      })
    ).toThrow(/must encrypt secrets/);
  });

  it("rejects malformed stores and runtime capabilities", () => {
    const base = new TestStore({
      persistence: "process-local",
      secretProtection: "none",
    });
    for (const capabilities of [
      undefined,
      {},
      { persistence: "disk", secretProtection: "none" },
      { persistence: "persistent", secretProtection: "maybe" },
    ]) {
      expect(() =>
        resolveOAuthProxyStore({
          store: Object.assign(Object.create(base), { capabilities }),
        })
      ).toThrow(/capabilit/);
    }
    expect(() =>
      resolveOAuthProxyStore({ store: { capabilities: base.capabilities } } as {
        store: OAuthProxyStore;
      })
    ).toThrow(/methods/);
    expect(() =>
      resolveOAuthProxyStore({ store: null as unknown as OAuthProxyStore })
    ).toThrow(/store must be an object/);
  });
});

describe("process-local OAuth proxy store", () => {
  it("snapshots helper writes before waiting for a transaction lock", async () => {
    const store = inMemoryOAuthStore();
    let releaseLock = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const lock = store.transaction(["lock"], () => gate);
    const original = bytes("original-secret");
    const created = createOAuthProxyStoreEntry(
      store,
      "direct",
      original,
      future()
    );
    original.fill(0);
    releaseLock();
    await lock;
    await created;

    const first = await readOAuthProxyStoreEntry(store, "direct");
    expect(first).toMatchObject({ status: "found" });
    if (first.status === "found") {
      expect(text(first.payload)).toBe("original-secret");
    }

    const replacement = bytes("replacement-secret");
    const replaced = replace(store, "direct", replacement, future());
    replacement.fill(0);
    await replaced;
    const second = await readOAuthProxyStoreEntry(store, "direct");
    expect(second).toMatchObject({ status: "found" });
    if (second.status === "found") {
      expect(text(second.payload)).toBe("replacement-secret");
    }
  });

  it("consumes exactly once and retains an unexpired tombstone", async () => {
    const { store } = resolveOAuthProxyStore();
    await createOAuthProxyStoreEntry(
      store,
      "transaction:once",
      bytes("one-time"),
      future()
    );
    const results = await Promise.all(
      Array.from({ length: 20 }, () => consume(store, "transaction:once"))
    );
    expect(
      results.filter((result) => result.status === "consumed")
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "replayed")
    ).toHaveLength(19);
    await expect(
      readOAuthProxyStoreEntry(store, "transaction:once")
    ).resolves.toEqual({ status: "replayed" });
    await expect(
      createOAuthProxyStoreEntry(
        store,
        "transaction:once",
        bytes("replacement"),
        future()
      )
    ).resolves.toEqual({ status: "conflict" });
  });

  it("cleans up expired live values and tombstones", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-26T12:00:00Z"));
      const { store } = resolveOAuthProxyStore();
      await createOAuthProxyStoreEntry(
        store,
        "live",
        bytes("live"),
        Date.now() + 1_000
      );
      await createOAuthProxyStoreEntry(
        store,
        "used",
        bytes("used"),
        Date.now() + 1_000
      );
      await consume(store, "used");

      vi.advanceTimersByTime(1_001);
      await expect(readOAuthProxyStoreEntry(store, "live")).resolves.toEqual({
        status: "missing",
      });
      await expect(consume(store, "used")).resolves.toEqual({
        status: "missing",
      });
      await expect(
        createOAuthProxyStoreEntry(
          store,
          "used",
          bytes("new"),
          Date.now() + 1_000
        )
      ).resolves.toEqual({ status: "created" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("copies payload bytes at the store boundary", async () => {
    const { store } = resolveOAuthProxyStore();
    const original = bytes("secret");
    await createOAuthProxyStoreEntry(store, "copy", original, future());
    original.fill(0);
    const firstRead = await readOAuthProxyStoreEntry(store, "copy");
    if (firstRead.status === "found") firstRead.payload.fill(0);
    const secondRead = await readOAuthProxyStoreEntry(store, "copy");
    expect(secondRead.status).toBe("found");
    if (secondRead.status === "found") {
      expect(text(secondRead.payload)).toBe("secret");
    }
  });

  it("bounds the total number of entries", async () => {
    const { store } = resolveOAuthProxyStore();
    for (let index = 0; index < 10_000; index += 1) {
      await createOAuthProxyStoreEntry(
        store,
        `bounded:${index}`,
        new Uint8Array(),
        future()
      );
    }
    await expect(
      createOAuthProxyStoreEntry(
        store,
        "bounded:overflow",
        new Uint8Array(),
        future()
      )
    ).rejects.toThrow(/capacity exceeded/);
  });
});

describe("OAuth proxy store transactions", () => {
  it("commits cross-key work atomically and blocks interleaved operations", async () => {
    const { store } = resolveOAuthProxyStore();
    let releaseTransaction = (): void => undefined;
    const transactionGate = new Promise<void>((resolve) => {
      releaseTransaction = resolve;
    });
    const transaction = store.transaction(
      ["rotation:new", "rotation:old"],
      async (tx) => {
        await tx.create("rotation:old", bytes("old"), future());
        await transactionGate;
        await tx.create("rotation:new", bytes("new"), future());
      }
    );
    let interleavedReadFinished = false;
    const interleavedRead = readOAuthProxyStoreEntry(
      store,
      "rotation:old"
    ).then((result) => {
      interleavedReadFinished = true;
      return result;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(interleavedReadFinished).toBe(false);

    releaseTransaction();
    await transaction;
    await expect(interleavedRead).resolves.toMatchObject({ status: "found" });
    await expect(
      readOAuthProxyStoreEntry(store, "rotation:new")
    ).resolves.toMatchObject({ status: "found" });
  });

  it("rolls back all staged operations when work throws", async () => {
    const { store } = resolveOAuthProxyStore();
    await createOAuthProxyStoreEntry(
      store,
      "existing",
      bytes("original"),
      future()
    );
    await expect(
      store.transaction(["existing", "new"], async (tx) => {
        await tx.consume("existing");
        await tx.create("new", bytes("created"), future());
        throw new Error("abort rotation");
      })
    ).rejects.toThrow("abort rotation");

    const existing = await readOAuthProxyStoreEntry(store, "existing");
    expect(existing.status).toBe("found");
    if (existing.status === "found") {
      expect(text(existing.payload)).toBe("original");
    }
    await expect(readOAuthProxyStoreEntry(store, "new")).resolves.toEqual({
      status: "missing",
    });
  });

  it("allows exactly one concurrent refresh-like rotation", async () => {
    const { store } = resolveOAuthProxyStore();
    await createOAuthProxyStoreEntry(
      store,
      "refresh:old",
      bytes("old-secret"),
      future()
    );
    const rotate = () =>
      store.transaction(["refresh:new", "refresh:old"], async (tx) => {
        const consumed = await tx.consume("refresh:old");
        if (consumed.status !== "consumed") return false;
        const created = await tx.create(
          "refresh:new",
          bytes("new-secret"),
          future()
        );
        if (created.status !== "created") {
          throw new Error("new refresh key unexpectedly exists");
        }
        return true;
      });

    const results = await Promise.all([rotate(), rotate()]);
    expect(results.filter(Boolean)).toHaveLength(1);
    await expect(
      readOAuthProxyStoreEntry(store, "refresh:old")
    ).resolves.toEqual({ status: "replayed" });
    await expect(
      readOAuthProxyStoreEntry(store, "refresh:new")
    ).resolves.toMatchObject({ status: "found" });
  });

  it("replaces live records but never missing records or tombstones", async () => {
    const { store } = resolveOAuthProxyStore();
    await createOAuthProxyStoreEntry(store, "live", bytes("first"), future());
    await expect(
      replace(store, "live", bytes("second"), future())
    ).resolves.toEqual({ status: "replaced" });
    const replaced = await readOAuthProxyStoreEntry(store, "live");
    if (replaced.status === "found")
      expect(text(replaced.payload)).toBe("second");

    await consume(store, "live");
    await expect(
      replace(store, "live", bytes("resurrected"), future())
    ).resolves.toEqual({ status: "replayed" });
    await expect(
      replace(store, "missing", bytes("created"), future())
    ).resolves.toEqual({ status: "missing" });
  });

  it("rejects undeclared keys and uses canonical lock ordering", async () => {
    const persistent = new TestStore({
      persistence: "persistent",
      secretProtection: "store-encrypted",
    });
    const { store } = resolveOAuthProxyStore({ store: persistent });
    await expect(
      store.transaction(["z", "a", "z"], (tx) => tx.read("outside"))
    ).rejects.toThrow(/undeclared key/);
    expect(persistent.lastTransactionKeys).toEqual(["a", "z"]);
  });

  it("rejects expired writes and excessive keys or payloads", async () => {
    const { store } = resolveOAuthProxyStore();
    await expect(
      createOAuthProxyStoreEntry(store, "expired", bytes("value"), Date.now())
    ).rejects.toThrow(/future/);
    await expect(
      readOAuthProxyStoreEntry(store, "x".repeat(1025))
    ).rejects.toThrow(/1024/);
    await expect(
      createOAuthProxyStoreEntry(
        store,
        "large",
        new Uint8Array(1024 * 1024 + 1),
        future()
      )
    ).rejects.toThrow(/1048576/);
    await expect(
      store.transaction(
        Array.from({ length: 65 }, (_, index) => `key:${index}`),
        () => undefined
      )
    ).rejects.toThrow(/at most 64/);
  });
});
