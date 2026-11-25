/**
 * `fileStorage(dir)`: a durable single-instance store on the local disk
 * (Node.js only).
 *
 * @packageDocumentation
 */
// TODO(events): the `mcp-use/storage/node` entry (export map, not owned by
// WP-06) must re-export `fileStorage` and `FileStorageOptions` from here;
// `MCP_USE_STORAGE_URL=file:` loads it through that entry.
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import type { McpUseStorage } from "../types.js";
import { applyStoragePrefix, validateStoragePrefix } from "../prefix.js";
import {
  engineStorage,
  StorageEngine,
  type EngineSnapshot,
  type Mutation,
} from "./memory.js";

/** Options for {@link fileStorage}. */
export interface FileStorageOptions {
  /**
   * Prepended to every key the store writes. Must not contain `{` or `}`.
   *
   * @defaultValue `""`
   */
  prefix?: string;
  /**
   * Journal entries after which the journal is folded into the snapshot.
   *
   * @defaultValue `10000`
   */
  compactAfter?: number;
}

interface OpenDirectory {
  engine: StorageEngine;
  journalPath: string;
  snapshotPath: string;
  journalLines: number;
  compactAfter: number;
}

const SNAPSHOT = "snapshot.json";
const JOURNAL = "journal.jsonl";
const LOCK = "lock";

// Process-global, so hot-reload generations of the dev runtime share one
// open directory instead of fighting over its lock.
const OPEN_KEY = Symbol.for("mcp-use.storage.fileStorage.open");
const openDirectories: Map<string, OpenDirectory> = ((
  globalThis as Record<symbol, unknown>
)[OPEN_KEY] ??= new Map()) as Map<string, OpenDirectory>;

/**
 * Creates a durable store in a directory on the local disk: a JSON snapshot
 * plus an append-only journal of every change, written synchronously before
 * the operation resolves.
 *
 * One process owns a directory at a time (a `lock` file holds its pid);
 * opening a directory another live process holds throws. Within one
 * process every call with the same directory shares one store, so hot
 * reloads keep their state. The store is `durable: true`, `shared: false`:
 * use it for local development or a single instance with a persistent
 * volume, not behind a load balancer. Its `signal` is in-process.
 *
 * @param dir - Directory of the store; created when missing.
 * @param options - Key prefix and journal compaction threshold.
 * @returns A store that survives process restarts.
 *
 * @example
 * ```ts
 * import { fileStorage } from "mcp-use/storage/node";
 *
 * const storage = fileStorage(".mcp-use/state/events");
 * ```
 */
export function fileStorage(
  dir: string,
  options?: FileStorageOptions
): McpUseStorage {
  if (typeof dir !== "string" || dir === "") {
    throw new TypeError("fileStorage requires a directory");
  }
  const prefix = validateStoragePrefix(options?.prefix, "fileStorage");
  const open = openDirectory(resolve(dir), options?.compactAfter ?? 10_000);
  return applyStoragePrefix(
    engineStorage(open.engine, {
      kind: "file",
      durable: true,
      shared: false,
      afterWrite: () => {
        if (open.journalLines >= open.compactAfter) compact(open);
      },
    }),
    prefix
  );
}

function openDirectory(dir: string, compactAfter: number): OpenDirectory {
  const existing = openDirectories.get(dir);
  if (existing) return existing;
  mkdirSync(dir, { recursive: true });
  acquireLock(dir);
  const engine = new StorageEngine();
  const snapshotPath = resolve(dir, SNAPSHOT);
  const journalPath = resolve(dir, JOURNAL);
  if (existsSync(snapshotPath)) {
    engine.restore(
      JSON.parse(readFileSync(snapshotPath, "utf8")) as EngineSnapshot
    );
  }
  if (existsSync(journalPath)) {
    for (const line of readFileSync(journalPath, "utf8").split("\n")) {
      if (line === "") continue;
      let mutation: Mutation;
      try {
        mutation = JSON.parse(line) as Mutation;
      } catch {
        // A torn last line from a crash mid-write: that op never resolved.
        break;
      }
      engine.apply(mutation, false);
    }
  }
  const open: OpenDirectory = {
    engine,
    journalPath,
    snapshotPath,
    journalLines: 0,
    compactAfter,
  };
  compact(open);
  engine.onMutation = (mutation) => {
    appendFileSync(journalPath, JSON.stringify(mutation) + "\n");
    open.journalLines++;
  };
  openDirectories.set(dir, open);
  return open;
}

function compact(open: OpenDirectory): void {
  const tmp = `${open.snapshotPath}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(open.engine.snapshot()));
  renameSync(tmp, open.snapshotPath);
  writeFileSync(open.journalPath, "");
  open.journalLines = 0;
}

function acquireLock(dir: string): void {
  const lockPath = resolve(dir, LOCK);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(lockPath, "wx");
      writeFileSync(fd, String(process.pid));
      closeSync(fd);
      process.once("exit", () => {
        try {
          if (readFileSync(lockPath, "utf8") === String(process.pid)) {
            unlinkSync(lockPath);
          }
        } catch {
          // already gone
        }
      });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const owner = Number(readFileSync(lockPath, "utf8"));
      if (owner === process.pid || !isAlive(owner)) {
        unlinkSync(lockPath);
        continue;
      }
      throw new Error(
        `fileStorage: ${dir} is in use by process ${owner}. One process owns a file store at a time; stop it or use another directory.`
      );
    }
  }
  throw new Error(`fileStorage: could not lock ${dir}`);
}

function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
