import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { list } from "tar";
import { packProjectTarball, sanitizeRepoName } from "../src/utils/tarball.js";

describe("sanitizeRepoName", () => {
  it("keeps already-valid names", () => {
    expect(sanitizeRepoName("my-mcp.server_1")).toBe("my-mcp.server_1");
  });

  it("replaces invalid characters with dashes", () => {
    expect(sanitizeRepoName("@scope/My Cool App!")).toBe("scope-My-Cool-App");
  });

  it("trims leading/trailing separators and caps length", () => {
    expect(sanitizeRepoName("---weird---")).toBe("weird");
    expect(sanitizeRepoName("a".repeat(200)).length).toBe(80);
  });

  it("falls back to a default when empty", () => {
    expect(sanitizeRepoName("@#$%")).toBe("mcp-server");
  });
});

describe("packProjectTarball", () => {
  it("nests entries under a prefix and excludes deps/build/secrets", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tarball-test-"));
    try {
      await writeFile(join(dir, "package.json"), '{"name":"demo"}');
      await mkdir(join(dir, "src"), { recursive: true });
      await writeFile(join(dir, "src", "index.ts"), "export const x = 1;");
      await writeFile(join(dir, ".env"), "SECRET=should-not-ship");
      await mkdir(join(dir, "node_modules", "left-pad"), { recursive: true });
      await writeFile(join(dir, "node_modules", "left-pad", "index.js"), "//");
      await mkdir(join(dir, "dist"), { recursive: true });
      await writeFile(join(dir, "dist", "index.js"), "//");

      const buf = await packProjectTarball(dir, "app");
      expect(buf.length).toBeGreaterThan(0);

      // Re-read the archive entries to assert layout + exclusions.
      const archivePath = join(dir, "out.tgz");
      await writeFile(archivePath, buf);
      const found: string[] = [];
      await list({ file: archivePath, onentry: (e) => found.push(e.path) });

      const normalized = found.map((p) => p.replace(/\/$/, ""));
      expect(normalized).toContain("app/package.json");
      expect(normalized).toContain("app/src/index.ts");
      expect(normalized.some((p) => p.includes("node_modules"))).toBe(false);
      expect(normalized.some((p) => p.startsWith("app/dist"))).toBe(false);
      expect(normalized.some((p) => p.endsWith(".env"))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
