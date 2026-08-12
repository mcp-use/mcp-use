import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { KVStore } from "./storage.js";

const isWindows = process.platform === "win32";

/**
 * `KVStore` implementation backed by `~/.mcp-use/oauth/<serverUrlHash>/`.
 *
 * @internal
 */
export class FileKVStore implements KVStore {
  readonly dir: string;

  constructor(serverUrlHash: string, baseDir?: string) {
    const root = baseDir ?? join(homedir(), ".mcp-use", "oauth");
    this.dir = join(root, serverUrlHash);
    // Keep construction and reads side-effect free. The directory is created
    // only by set(), when OAuth state actually needs to be persisted.
  }

  private ensureDir(): void {
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    }
    if (!isWindows) {
      try {
        chmodSync(this.dir, 0o700);
      } catch {
        // Best-effort: chmod can fail on shared volumes.
      }
    }
  }

  private sanitize(key: string): string {
    return key.replace(/[^a-zA-Z0-9._-]/g, "_");
  }

  private pathFor(key: string): string {
    return join(this.dir, this.sanitize(key));
  }

  get(key: string): string | null {
    const file = this.pathFor(key);
    if (!existsSync(file)) return null;
    try {
      return readFileSync(file, "utf-8");
    } catch {
      return null;
    }
  }

  set(key: string, value: string): void {
    this.ensureDir();
    const file = this.pathFor(key);
    const tmp = `${file}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
    writeFileSync(tmp, value, { encoding: "utf-8", mode: 0o600 });
    if (!isWindows) {
      try {
        chmodSync(tmp, 0o600);
      } catch {
        // Best-effort.
      }
    }
    renameSync(tmp, file);
  }

  remove(key: string): void {
    const file = this.pathFor(key);
    if (existsSync(file)) {
      rmSync(file, { force: true });
    }
  }

  keys(): string[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir).filter((name) => !name.includes(".tmp."));
  }
}
