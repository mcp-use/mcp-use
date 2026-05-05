/**
 * Unit tests for FileKVStore.
 *
 * Run with:
 *   pnpm --filter mcp-use test:unit -- tests/unit/auth/file-kv-store.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FileKVStore } from "../../../src/auth/file-kv-store.js";
import { mkdtempSync, rmSync, statSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const isWindows = process.platform === "win32";

let baseDir: string;

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "mcp-use-fkv-"));
});

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

describe("FileKVStore", () => {
  it("round-trips simple keys", () => {
    const kv = new FileKVStore("abc123", baseDir);
    kv.set("tokens", '{"access":"x"}');
    expect(kv.get("tokens")).toBe('{"access":"x"}');
  });

  it("returns null for missing keys", () => {
    const kv = new FileKVStore("abc123", baseDir);
    expect(kv.get("nope")).toBeNull();
  });

  it("removes keys", () => {
    const kv = new FileKVStore("abc123", baseDir);
    kv.set("k", "v");
    expect(kv.get("k")).toBe("v");
    kv.remove("k");
    expect(kv.get("k")).toBeNull();
  });

  it("remove on missing key is a no-op", () => {
    const kv = new FileKVStore("abc123", baseDir);
    expect(() => kv.remove("never-set")).not.toThrow();
  });

  it("lists keys (excluding tmp files)", () => {
    const kv = new FileKVStore("abc123", baseDir);
    kv.set("tokens", "1");
    kv.set("client_info", "2");
    expect(kv.keys().sort()).toEqual(["client_info", "tokens"]);
  });

  it("isolates per server hash", () => {
    const a = new FileKVStore("hash-a", baseDir);
    const b = new FileKVStore("hash-b", baseDir);
    a.set("tokens", "from-a");
    b.set("tokens", "from-b");
    expect(a.get("tokens")).toBe("from-a");
    expect(b.get("tokens")).toBe("from-b");
  });

  it("sanitizes keys with colons (cross-platform safety)", () => {
    const kv = new FileKVStore("abc123", baseDir);
    kv.set("mcp:auth_abc123_tokens", "T");
    kv.set("mcp:auth:state_xyz", "S");
    expect(kv.get("mcp:auth_abc123_tokens")).toBe("T");
    expect(kv.get("mcp:auth:state_xyz")).toBe("S");
    // Keys list returns sanitized filenames, both present.
    expect(kv.keys()).toHaveLength(2);
  });

  it("rejects directory traversal in keys", () => {
    const kv = new FileKVStore("abc123", baseDir);
    // Sanitization replaces "/" with "_", so this becomes a flat name.
    expect(() => kv.set("../escape", "no")).not.toThrow();
    expect(kv.get("../escape")).toBe("no");
    // The actual file should be inside this.dir, not outside it.
    const files = readdirSync(baseDir);
    // baseDir contains exactly one subdir (abc123); no traversal-up files.
    expect(files).toEqual(["abc123"]);
  });

  it("overwrites existing values atomically (no .tmp residue)", () => {
    const kv = new FileKVStore("abc123", baseDir);
    kv.set("k", "v1");
    kv.set("k", "v2");
    expect(kv.get("k")).toBe("v2");
    // No temp files left over.
    const dir = join(baseDir, "abc123");
    const remaining = readdirSync(dir);
    expect(remaining.filter((n) => n.includes(".tmp."))).toEqual([]);
  });

  it.skipIf(isWindows)("creates dir 0o700 and files 0o600", () => {
    const kv = new FileKVStore("abc123", baseDir);
    kv.set("tokens", "secret");
    const dirStat = statSync(join(baseDir, "abc123"));
    expect(dirStat.mode & 0o777).toBe(0o700);
    const fileStat = statSync(join(baseDir, "abc123", "tokens"));
    expect(fileStat.mode & 0o777).toBe(0o600);
  });
});
