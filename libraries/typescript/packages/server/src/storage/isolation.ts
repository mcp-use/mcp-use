/**
 * `runStorageIsolationCheck`: shows that a credential scoped to one key
 * prefix of a database can neither read nor write another prefix's keys.
 *
 * @packageDocumentation
 */
import type { McpUseStorage } from "./types.js";

/** Identifier of one isolation check. */
export type StorageIsolationCheckId =
  | "ALLOWED-READ-WRITE"
  | "DENIED-READ"
  | "DENIED-WRITE";

/** Outcome of one isolation check. */
export interface StorageIsolationCheckResult {
  /** The check. */
  id: StorageIsolationCheckId;
  /** Whether the check held. */
  status: "pass" | "fail";
  /** Why the check failed. */
  detail?: string;
}

/** Result of {@link runStorageIsolationCheck}. */
export interface StorageIsolationReport {
  /** `true` when every check passed. */
  passed: boolean;
  /** One result per check. */
  checks: StorageIsolationCheckResult[];
}

/**
 * The two stores {@link runStorageIsolationCheck} compares. Both must be
 * built with the same `prefix` and the same endpoint; only the credential
 * differs. A `denied` store with another prefix never addresses `allowed`'s
 * keys, so the check would pass whatever its credential may do.
 */
export interface StorageIsolationOptions {
  /** A store whose credential owns the keys under test. */
  allowed: McpUseStorage;
  /**
   * A store with the same endpoint and the same `prefix` as `allowed`, but a
   * credential that is not scoped to that prefix. It must not reach
   * `allowed`'s keys.
   */
  denied: McpUseStorage;
}

const TTL_MS = 10 * 60 * 1000;

/**
 * Takes two stores built from the same endpoint and the same `prefix` with
 * different credentials, and checks that `allowed` can read and write its
 * own keys (KV, OAuth, index, log) while `denied` can neither read them nor
 * change them. A refused operation (an ACL error) counts as isolated. It
 * does not throw on failure.
 *
 * Build `denied` with `allowed`'s prefix: with a different prefix it writes
 * other keys, and the check passes without testing the credential.
 *
 * @param options - The allowed and denied stores.
 * @returns One result per check.
 */
export async function runStorageIsolationCheck(
  options: StorageIsolationOptions
): Promise<StorageIsolationReport> {
  const { allowed, denied } = options;
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  const run = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    ""
  );
  const key = (name: string) => `mcp-use-isolation:{${run}}:${name}`;
  const k = key("kv");
  const o = key("oauth");
  const ix = key("index");
  const s = key("log");
  const checks: StorageIsolationCheckResult[] = [];
  const quietly = async (work: () => Promise<unknown>): Promise<unknown> => {
    try {
      return await work();
    } catch {
      return undefined;
    }
  };

  // Everything allowed must see after its own writes, and still see after
  // denied tried to change it.
  const allowedView = async (): Promise<string | undefined> => {
    const value = (await allowed.read(k))?.value;
    if (value !== "allowed")
      return `allowed reads ${JSON.stringify(value)} at its KV key`;
    const oauth = await allowed.get(o);
    if (oauth !== "allowed")
      return `allowed reads ${JSON.stringify(oauth)} at its OAuth key`;
    const members = (await allowed.indexRange(ix, { limit: 10 })).items;
    if (JSON.stringify(members) !== '[{"member":"m","score":1}]') {
      return `allowed reads index ${JSON.stringify(members)}`;
    }
    const log = await allowed.logRange(s, { after: null, limit: 10 });
    if (
      log.head !== 1 ||
      JSON.stringify(log.entries) !== '[{"seq":1,"value":"allowed"}]'
    ) {
      return `allowed reads log head ${log.head} with ${log.entries.length} entries`;
    }
    return undefined;
  };

  let allowedFailure: string | undefined;
  try {
    await allowed.write(k, "allowed", { ttlMs: TTL_MS });
    await allowed.set(o, "allowed", 600);
    await allowed.indexAdd(ix, "m", 1);
    await allowed.logAppend(s, "allowed", { maxEvents: 10 });
    allowedFailure = await allowedView();
  } catch (error) {
    allowedFailure = `allowed failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  checks.push(
    allowedFailure === undefined
      ? { id: "ALLOWED-READ-WRITE", status: "pass" }
      : { id: "ALLOWED-READ-WRITE", status: "fail", detail: allowedFailure }
  );

  if (allowedFailure !== undefined) {
    const detail = "not evaluated: the allowed store could not write";
    checks.push(
      { id: "DENIED-READ", status: "fail", detail },
      { id: "DENIED-WRITE", status: "fail", detail }
    );
  } else {
    const seen: string[] = [];
    if (
      (await quietly(async () => (await denied.read(k))?.value)) !== undefined
    ) {
      seen.push("KV key");
    }
    if ((await quietly(() => denied.get(o))) !== undefined)
      seen.push("OAuth key");
    if (((await quietly(() => denied.indexCount(ix))) ?? 0) !== 0) {
      seen.push("index");
    }
    const head = await quietly(
      async () => (await denied.logRange(s, { after: null, limit: 0 })).head
    );
    if ((head ?? 0) !== 0) seen.push("log");
    checks.push(
      seen.length === 0
        ? { id: "DENIED-READ", status: "pass" }
        : {
            id: "DENIED-READ",
            status: "fail",
            detail: `denied reads allowed's ${seen.join(", ")}`,
          }
    );

    await quietly(() => denied.write(k, "denied", { ttlMs: TTL_MS }));
    await quietly(() => denied.set(o, "denied", 600));
    await quietly(() => denied.indexAdd(ix, "denied", 2));
    await quietly(() => denied.indexRemove(ix, "m"));
    await quietly(() => denied.logAppend(s, "denied", { maxEvents: 10 }));
    const changed = await allowedView();
    await quietly(() => denied.remove(k));
    await quietly(() => denied.delete(o));
    await quietly(() => denied.logDelete(s));
    const removed = changed ?? (await allowedView());
    checks.push(
      removed === undefined
        ? { id: "DENIED-WRITE", status: "pass" }
        : { id: "DENIED-WRITE", status: "fail", detail: removed }
    );
  }

  for (const store of [allowed, denied]) {
    await quietly(() => store.remove(k));
    await quietly(() => store.delete(o));
    await quietly(() => store.indexRemove(ix, "m"));
    await quietly(() => store.indexRemove(ix, "denied"));
    await quietly(() => store.logDelete(s));
  }
  return {
    passed: checks.every((result) => result.status === "pass"),
    checks,
  };
}
