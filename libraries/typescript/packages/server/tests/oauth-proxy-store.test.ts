import { describe, expect, it, vi } from "vitest";

import {
  createOAuthProxyEncryptionCodec,
  type OAuthProxyEncryptionOptions,
} from "../src/oauth/proxy/encryption.js";
import {
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

function key(fill: number): Uint8Array {
  return new Uint8Array(32).fill(fill);
}

function encryption(
  primaryKeyId = "current",
  keys: OAuthProxyEncryptionOptions["keys"] = [{ id: "current", key: key(7) }]
): OAuthProxyEncryptionOptions {
  return { primaryKeyId, keys };
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

  create(key: string, payload: Uint8Array, expiresAt: number) {
    return this.transaction([key], (transaction) =>
      transaction.create(key, payload, expiresAt)
    );
  }

  read(key: string) {
    return this.transaction([key], (transaction) => transaction.read(key));
  }

  replace(key: string, payload: Uint8Array, expiresAt: number) {
    return this.transaction([key], (transaction) =>
      transaction.replace(key, payload, expiresAt)
    );
  }

  consume(key: string) {
    return this.transaction([key], (transaction) => transaction.consume(key));
  }

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
          if (staged.has(key)) {
            return { status: "conflict" };
          }
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
          if (value === undefined) {
            return { status: "missing" };
          }
          return value.kind === "tombstone"
            ? { status: "replayed" }
            : { status: "found", payload: Uint8Array.from(value.payload) };
        },
        async replace(key, payload, expiresAt) {
          assertDeclared(key);
          const value = staged.get(key);
          if (value === undefined) {
            return { status: "missing" };
          }
          if (value.kind === "tombstone") {
            return { status: "replayed" };
          }
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
          if (value === undefined) {
            return { status: "missing" };
          }
          if (value.kind === "tombstone") {
            return { status: "replayed" };
          }
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
      for (const [key, value] of staged) {
        this.values.set(key, value);
      }
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
    expect(first.sdkEncryption).toBe(false);
    await expect(
      first.store.create("transaction:a", bytes("secret"), future())
    ).resolves.toEqual({ status: "created" });
    await expect(second.store.read("transaction:a")).resolves.toEqual({
      status: "missing",
    });
  });

  it("preserves a custom persistent store across resolver instances", async () => {
    const persistent = new TestStore({
      persistence: "persistent",
      secretProtection: "none",
    });
    const first = resolveOAuthProxyStore({
      store: persistent,
      encryption: encryption(),
    });
    await first.store.create("transaction:a", bytes("secret"), future());

    const afterRestart = resolveOAuthProxyStore({
      store: persistent,
      encryption: encryption(),
    });
    const result = await afterRestart.store.read("transaction:a");
    expect(result.status).toBe("found");
    if (result.status === "found") {
      expect(text(result.payload)).toBe("secret");
    }
  });

  it("enforces the persistent-store protection matrix", () => {
    expect(() =>
      resolveOAuthProxyStore({
        store: new TestStore({
          persistence: "persistent",
          secretProtection: "none",
        }),
      })
    ).toThrow(/require SDK encryption/);

    const storeEncrypted = new TestStore({
      persistence: "persistent",
      secretProtection: "store-encrypted",
    });
    expect(
      resolveOAuthProxyStore({ store: storeEncrypted }).sdkEncryption
    ).toBe(false);

    const sdkEncrypted = resolveOAuthProxyStore({
      store: new TestStore({
        persistence: "persistent",
        secretProtection: "none",
      }),
      encryption: encryption(),
    });
    expect(sdkEncrypted.sdkEncryption).toBe(true);
  });

  it("rejects malformed or missing runtime capabilities", () => {
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
  });
});

describe("process-local OAuth proxy store", () => {
  it("consumes exactly once concurrently and retains an unexpired tombstone", async () => {
    const { store } = resolveOAuthProxyStore();
    await store.create("transaction:once", bytes("one-time"), future());

    const results = await Promise.all(
      Array.from({ length: 20 }, () => store.consume("transaction:once"))
    );
    expect(
      results.filter((result) => result.status === "consumed")
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "replayed")
    ).toHaveLength(19);
    await expect(store.read("transaction:once")).resolves.toEqual({
      status: "replayed",
    });
    await expect(
      store.create("transaction:once", bytes("replacement"), future())
    ).resolves.toEqual({ status: "conflict" });
  });

  it("cleans up expired live values and tombstones", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-26T12:00:00Z"));
      const { store } = resolveOAuthProxyStore();
      await store.create("live", bytes("live"), Date.now() + 1_000);
      await store.create("used", bytes("used"), Date.now() + 1_000);
      await store.consume("used");

      vi.advanceTimersByTime(1_001);
      await expect(store.read("live")).resolves.toEqual({ status: "missing" });
      await expect(store.consume("used")).resolves.toEqual({
        status: "missing",
      });
      await expect(
        store.create("used", bytes("new"), Date.now() + 1_000)
      ).resolves.toEqual({ status: "created" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("copies payload bytes at the store boundary", async () => {
    const { store } = resolveOAuthProxyStore();
    const original = bytes("secret");
    await store.create("copy", original, future());
    original.fill(0);
    const firstRead = await store.read("copy");
    expect(firstRead.status).toBe("found");
    if (firstRead.status === "found") {
      firstRead.payload.fill(0);
    }
    const secondRead = await store.read("copy");
    expect(secondRead.status).toBe("found");
    if (secondRead.status === "found") {
      expect(text(secondRead.payload)).toBe("secret");
    }
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
    const interleavedRead = store.read("rotation:old").then((result) => {
      interleavedReadFinished = true;
      return result;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(interleavedReadFinished).toBe(false);

    releaseTransaction();
    await transaction;
    await expect(interleavedRead).resolves.toMatchObject({ status: "found" });
    await expect(store.read("rotation:new")).resolves.toMatchObject({
      status: "found",
    });
  });

  it("rolls back creates, replacements, and consumption when work throws", async () => {
    const { store } = resolveOAuthProxyStore();
    await store.create("existing", bytes("original"), future());

    await expect(
      store.transaction(["existing", "new"], async (tx) => {
        await tx.consume("existing");
        await tx.create("new", bytes("created"), future());
        throw new Error("abort rotation");
      })
    ).rejects.toThrow("abort rotation");

    const existing = await store.read("existing");
    expect(existing.status).toBe("found");
    if (existing.status === "found") {
      expect(text(existing.payload)).toBe("original");
    }
    await expect(store.read("new")).resolves.toEqual({ status: "missing" });
  });

  it("allows exactly one concurrent refresh-like rotation", async () => {
    const { store } = resolveOAuthProxyStore();
    await store.create("refresh:old", bytes("old-secret"), future());

    const rotate = () =>
      store.transaction(["refresh:new", "refresh:old"], async (tx) => {
        const consumed = await tx.consume("refresh:old");
        if (consumed.status !== "consumed") {
          return false;
        }
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
    await expect(store.read("refresh:old")).resolves.toEqual({
      status: "replayed",
    });
    const replacement = await store.read("refresh:new");
    expect(replacement.status).toBe("found");
  });

  it("replaces live records but never missing records or tombstones", async () => {
    const { store } = resolveOAuthProxyStore();
    await store.create("live", bytes("first"), future());
    await expect(
      store.replace("live", bytes("second"), future())
    ).resolves.toEqual({ status: "replaced" });
    const replaced = await store.read("live");
    expect(replaced.status).toBe("found");
    if (replaced.status === "found") {
      expect(text(replaced.payload)).toBe("second");
    }

    await store.consume("live");
    await expect(
      store.replace("live", bytes("resurrected"), future())
    ).resolves.toEqual({ status: "replayed" });
    await expect(
      store.replace("missing", bytes("created"), future())
    ).resolves.toEqual({ status: "missing" });
  });

  it("rejects undeclared keys and forwards canonical lock ordering", async () => {
    const persistent = new TestStore({
      persistence: "persistent",
      secretProtection: "store-encrypted",
    });
    const { store } = resolveOAuthProxyStore({ store: persistent });

    await expect(
      store.transaction(["z", "a", "z"], (tx) => tx.read("outside"))
    ).rejects.toThrow(/not declared/);
    expect(persistent.lastTransactionKeys).toEqual(["a", "z"]);
  });

  it("encrypts every transaction payload using its final key as AAD", async () => {
    const persistent = new TestStore({
      persistence: "persistent",
      secretProtection: "none",
    });
    const { store } = resolveOAuthProxyStore({
      store: persistent,
      encryption: encryption(),
    });
    await store.transaction(["token:a", "token:b"], async (tx) => {
      await tx.create("token:a", bytes("secret-a"), future());
      await tx.create("token:b", bytes("secret-b"), future());
    });

    const rawA = persistent.values.get("token:a");
    const rawB = persistent.values.get("token:b");
    expect(rawA?.kind).toBe("live");
    expect(rawB?.kind).toBe("live");
    if (rawA?.kind === "live" && rawB?.kind === "live") {
      expect(text(rawA.payload)).not.toContain("secret-a");
      expect(text(rawB.payload)).not.toContain("secret-b");
      persistent.values.set("token:a", {
        ...rawA,
        payload: Uint8Array.from(rawB.payload),
      });
      await expect(store.read("token:a")).rejects.toThrow(/Unable to decrypt/);
    }
  });

  it("rejects expired writes and excessive keys or payloads", async () => {
    const { store } = resolveOAuthProxyStore();
    await expect(
      store.create("expired", bytes("value"), Date.now())
    ).rejects.toThrow(/future/);
    await expect(store.read("expired")).resolves.toEqual({ status: "missing" });

    await store.create("live", bytes("original"), future());
    await expect(
      store.transaction(["live", "new"], async (tx) => {
        await tx.replace("live", bytes("changed"), Date.now() - 1);
        await tx.create("new", bytes("new"), future());
      })
    ).rejects.toThrow(/future/);
    const live = await store.read("live");
    expect(live.status).toBe("found");
    if (live.status === "found") {
      expect(text(live.payload)).toBe("original");
    }

    await expect(store.read("x".repeat(1025))).rejects.toThrow(/1024/);
    await expect(
      store.create("large", new Uint8Array(1024 * 1024 + 1), future())
    ).rejects.toThrow(/1048576/);
    await expect(
      store.transaction(
        Array.from({ length: 65 }, (_, index) => `key:${index}`),
        () => undefined
      )
    ).rejects.toThrow(/at most 64/);
  });
});

describe("OAuth proxy encryption", () => {
  it("round-trips with random IVs and emits no plaintext", async () => {
    const codec = createOAuthProxyEncryptionCodec(encryption());
    const plaintext = bytes("refresh-token-super-secret");
    const first = await codec.encode("token:user-1", plaintext);
    const second = await codec.encode("token:user-1", plaintext);

    expect(first).not.toEqual(second);
    expect(text(first)).not.toContain("refresh-token-super-secret");
    expect(text(second)).not.toContain("refresh-token-super-secret");
    await expect(codec.decode("token:user-1", first)).resolves.toEqual(
      plaintext
    );
    await expect(codec.decode("token:user-1", second)).resolves.toEqual(
      plaintext
    );
  });

  it("binds ciphertext to the store key and fails closed on tamper or wrong keys", async () => {
    const codec = createOAuthProxyEncryptionCodec(encryption());
    const serialized = await codec.encode(
      "transaction:correct",
      bytes("secret")
    );

    await expect(codec.decode("transaction:wrong", serialized)).rejects.toThrow(
      /Unable to decrypt/
    );
    const envelope = JSON.parse(text(serialized)) as { ciphertext: string };
    envelope.ciphertext = `${envelope.ciphertext.slice(0, -1)}${
      envelope.ciphertext.endsWith("A") ? "B" : "A"
    }`;
    await expect(
      codec.decode("transaction:correct", bytes(JSON.stringify(envelope)))
    ).rejects.toThrow(/Unable to decrypt/);
    const wrongKey = createOAuthProxyEncryptionCodec(
      encryption("current", [{ id: "current", key: key(8) }])
    );
    await expect(
      wrongKey.decode("transaction:correct", serialized)
    ).rejects.toThrow(/Unable to decrypt/);
  });

  it("supports keyring rotation while writing only with the primary key", async () => {
    const oldKey = { id: "old", key: key(1) };
    const newKey = { id: "new", key: key(2) };
    const oldCodec = createOAuthProxyEncryptionCodec(
      encryption("old", [oldKey])
    );
    const oldCiphertext = await oldCodec.encode("token:1", bytes("old-value"));
    const rotatedCodec = createOAuthProxyEncryptionCodec(
      encryption("new", [newKey, oldKey])
    );

    await expect(
      rotatedCodec.decode("token:1", oldCiphertext)
    ).resolves.toEqual(bytes("old-value"));
    const newCiphertext = await rotatedCodec.encode(
      "token:2",
      bytes("new-value")
    );
    expect(JSON.parse(text(newCiphertext))).toMatchObject({ v: 1, kid: "new" });
    await expect(oldCodec.decode("token:2", newCiphertext)).rejects.toThrow(
      /Unable to decrypt/
    );
  });

  it("rejects malformed keyrings before storing anything", () => {
    const invalidOptions: unknown[] = [
      { primaryKeyId: "", keys: [{ id: "key", key: key(1) }] },
      { primaryKeyId: "key", keys: [] },
      { primaryKeyId: "missing", keys: [{ id: "key", key: key(1) }] },
      {
        primaryKeyId: "key",
        keys: [
          { id: "key", key: key(1) },
          { id: "key", key: key(2) },
        ],
      },
      { primaryKeyId: "key", keys: [{ id: "", key: key(1) }] },
      { primaryKeyId: "key", keys: [{ id: "key", key: new Uint8Array(31) }] },
      { primaryKeyId: "key", keys: [{ id: "key", key: "passphrase" }] },
    ];
    for (const options of invalidOptions) {
      expect(() =>
        createOAuthProxyEncryptionCodec(options as OAuthProxyEncryptionOptions)
      ).toThrow();
    }
  });

  it("encrypts before handing plaintext-unprotected persistent stores a payload", async () => {
    const persistent = new TestStore({
      persistence: "persistent",
      secretProtection: "none",
    });
    const { store } = resolveOAuthProxyStore({
      store: persistent,
      encryption: encryption(),
    });
    await store.create("token:user", bytes("access-token-secret"), future());

    const raw = persistent.values.get("token:user");
    expect(raw?.kind).toBe("live");
    if (raw?.kind === "live") {
      expect(text(raw.payload)).not.toContain("access-token-secret");
      expect(JSON.parse(text(raw.payload))).toMatchObject({
        v: 1,
        alg: "A256GCM",
        kid: "current",
      });
    }
  });
});
