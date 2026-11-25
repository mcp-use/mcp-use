/**
 * Storage adapters for the OAuth proxy (`oauthProxy` in `mcp-use/oauth`).
 *
 * Each adapter takes a client or binding that the application already has,
 * so this package adds no database dependency. The proxy encrypts every
 * value before an adapter sees it. Every adapter except `firestoreStorage`
 * also lives in `mcp-use/storage`, which this module re-exports.
 *
 * @packageDocumentation
 */
import type { OAuthProxyStorage } from "./proxy/storage.js";
import { isRecord } from "./guards.js";

export { memoryStorage, type OAuthProxyStorage } from "./proxy/storage.js";
export {
  upstashStorage,
  type UpstashStorageOptions,
} from "../storage/adapters/upstash.js";
export {
  redisStorage,
  type IORedisLikeClient,
  type NodeRedisLikeClient,
  type RedisLikeClient,
  type RedisStorageOptions,
} from "../storage/adapters/redis.js";
export {
  postgresStorage,
  type PostgresLikeClient,
  type PostgresStorageOptions,
} from "../storage/adapters/postgres.js";
export {
  cloudflareStorage,
  type CloudflareStorageOptions,
  type D1LikeDatabase,
} from "../storage/adapters/cloudflare-d1.js";
export {
  OAuthProxyDurableObject,
  type DurableObjectNamespaceLike,
  type DurableObjectStorageLike,
} from "../storage/adapters/cloudflare-do.js";
export type {
  McpUseStorage,
  StorageCapabilities,
  StorageOp,
  Versioned,
} from "../storage/types.js";

// ─── Firestore ───────────────────────────────────────────────────────────

/** The subset of a Firestore document snapshot the adapter uses. */
export interface FirestoreLikeDocumentSnapshot {
  /** Whether the document exists. */
  readonly exists: boolean;
  /** The document's fields, or `undefined` when it does not exist. */
  data(): Record<string, unknown> | undefined;
}

/** The subset of a Firestore document reference the adapter uses. */
export interface FirestoreLikeDocumentReference {
  /** Reads the document. */
  get(): Promise<FirestoreLikeDocumentSnapshot>;
  /** Writes the document, replacing it. */
  set(data: Record<string, unknown>): Promise<unknown>;
  /** Deletes the document. Deleting an absent document is not an error. */
  delete(): Promise<unknown>;
}

/** The subset of a Firestore transaction the adapter uses. */
export interface FirestoreLikeTransaction {
  /** Reads a document inside the transaction. */
  get(
    reference: FirestoreLikeDocumentReference
  ): Promise<FirestoreLikeDocumentSnapshot>;
  /** Writes a document when the transaction commits. */
  set(
    reference: FirestoreLikeDocumentReference,
    data: Record<string, unknown>
  ): unknown;
  /** Deletes a document when the transaction commits. */
  delete(reference: FirestoreLikeDocumentReference): unknown;
}

/**
 * A server-side Firestore database: the `Firestore` instance of
 * `@google-cloud/firestore`, or `getFirestore()` of `firebase-admin`.
 */
export interface FirestoreLikeDatabase {
  /** Gets a collection. */
  collection(path: string): {
    /** Gets a reference to the document with this ID. */
    doc(id: string): FirestoreLikeDocumentReference;
  };
  /** Runs a function in a transaction, retrying it on contention. */
  runTransaction<T>(
    update: (transaction: FirestoreLikeTransaction) => Promise<T>
  ): Promise<T>;
}

/** Options for {@link firestoreStorage}. */
export interface FirestoreStorageOptions {
  /** Firestore database, for example `getFirestore()` from `firebase-admin/firestore`. */
  firestore: FirestoreLikeDatabase;
  /**
   * Collection that holds one document per key.
   *
   * @defaultValue `"mcp_use_oauth"`
   */
  collection?: string;
}

/**
 * Creates a store in one Firestore collection, with the server SDK
 * (`firebase-admin` or `@google-cloud/firestore`). Atomic reads-and-deletes
 * and writes-if-absent run in transactions.
 *
 * Each document holds `value` and an `expiresAt` timestamp. The adapter
 * ignores expired documents, but Firestore keeps them until they are
 * deleted: add a TTL policy on the `expiresAt` field of the collection so
 * that Firestore removes them.
 *
 * The server SDK needs Node; it does not run on Cloudflare Workers or other
 * edge runtimes.
 *
 * @param options - Firestore database and collection name.
 * @returns A store for `oauthProxy`.
 *
 * @example
 * ```ts
 * import { initializeApp } from "firebase-admin/app";
 * import { getFirestore } from "firebase-admin/firestore";
 * import { firestoreStorage } from "mcp-use/oauth/storage";
 *
 * initializeApp();
 * const storage = firestoreStorage({ firestore: getFirestore() });
 * ```
 */
export function firestoreStorage(
  options: FirestoreStorageOptions
): OAuthProxyStorage {
  const firestore = options?.firestore;
  if (
    firestore === null ||
    typeof firestore?.collection !== "function" ||
    typeof firestore.runTransaction !== "function"
  ) {
    throw new TypeError(
      "firestoreStorage requires a Firestore database from firebase-admin or @google-cloud/firestore"
    );
  }
  const name = options.collection ?? "mcp_use_oauth";
  if (
    typeof name !== "string" ||
    !/^[^/]{1,1500}$/.test(name) ||
    /^__.*__$/.test(name) ||
    name === "." ||
    name === ".."
  ) {
    throw new TypeError(
      "firestoreStorage collection must be a collection ID without slashes"
    );
  }
  const collection = firestore.collection(name);
  // Keys can hold any character, and a document ID cannot hold "/".
  const document = (key: string) => collection.doc(encodeURIComponent(key));
  const live = (
    snapshot: FirestoreLikeDocumentSnapshot
  ): string | undefined => {
    if (!snapshot.exists) return undefined;
    const data = snapshot.data();
    const value = data?.["value"];
    return typeof value === "string" && expiresAtMillis(data) > Date.now()
      ? value
      : undefined;
  };
  const record = (value: string, ttlSeconds: number) => ({
    value,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000),
  });
  return {
    get: async (key) => live(await document(key).get()),
    set: async (key, value, ttlSeconds) => {
      await document(key).set(record(value, ttlSeconds));
    },
    delete: async (key) => {
      await document(key).delete();
    },
    take: (key) =>
      firestore.runTransaction(async (transaction) => {
        const reference = document(key);
        const snapshot = await transaction.get(reference);
        if (snapshot.exists) transaction.delete(reference);
        return live(snapshot);
      }),
    add: (key, value, ttlSeconds) =>
      firestore.runTransaction(async (transaction) => {
        const reference = document(key);
        if (live(await transaction.get(reference)) !== undefined) return false;
        transaction.set(reference, record(value, ttlSeconds));
        return true;
      }),
  };
}

/** Reads `expiresAt`, a Firestore `Timestamp` or a `Date`, as milliseconds. */
function expiresAtMillis(data: Record<string, unknown> | undefined): number {
  const expiresAt = data?.["expiresAt"];
  if (expiresAt instanceof Date) return expiresAt.getTime();
  if (isRecord(expiresAt) && typeof expiresAt["toMillis"] === "function") {
    const millis: unknown = (expiresAt["toMillis"] as () => unknown).call(
      expiresAt
    );
    return typeof millis === "number" ? millis : 0;
  }
  return 0;
}
