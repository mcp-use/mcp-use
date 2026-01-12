import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("CLI tsx Resolution", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `tsx-resolution-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await import("node:fs/promises").then((fs) =>
        fs.rm(testDir, { recursive: true, force: true })
      );
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should resolve tsx bin from package.json bin field (string form)", async () => {
    // Create mock tsx package.json
    const tsxDir = path.join(testDir, "node_modules", "tsx");
    await mkdir(tsxDir, { recursive: true });

    const tsxPackageJson = {
      name: "tsx",
      version: "4.0.0",
      bin: "./dist/cli.mjs",
    };

    await writeFile(
      path.join(tsxDir, "package.json"),
      JSON.stringify(tsxPackageJson, null, 2)
    );

    // Create the bin file
    await mkdir(path.join(tsxDir, "dist"), { recursive: true });
    await writeFile(
      path.join(tsxDir, "dist", "cli.mjs"),
      "#!/usr/bin/env node\nconsole.log('tsx mock');"
    );

    // Test resolution
    const { createRequire } = await import("node:module");
    const projectRequire = createRequire(path.join(testDir, "package.json"));

    const tsxPkgPath = projectRequire.resolve("tsx/package.json");
    const tsxPkg = JSON.parse(await readFile(tsxPkgPath, "utf-8"));

    expect(tsxPkg.bin).toBeDefined();
    expect(typeof tsxPkg.bin).toBe("string");

    const binPath = tsxPkg.bin;
    const tsxBin = path.resolve(path.dirname(tsxPkgPath), binPath);

    expect(tsxBin).toContain("dist/cli.mjs");
    expect(tsxBin).not.toContain("tsx/dist/cli.mjs"); // Should not be hardcoded
  });

  it("should resolve tsx bin from package.json bin field (object form)", async () => {
    // Create mock tsx package.json
    const tsxDir = path.join(testDir, "node_modules", "tsx");
    await mkdir(tsxDir, { recursive: true });

    const tsxPackageJson = {
      name: "tsx",
      version: "4.0.0",
      bin: {
        tsx: "./dist/cli.mjs",
        "tsx-watch": "./dist/watch.mjs",
      },
    };

    await writeFile(
      path.join(tsxDir, "package.json"),
      JSON.stringify(tsxPackageJson, null, 2)
    );

    // Create the bin files
    await mkdir(path.join(tsxDir, "dist"), { recursive: true });
    await writeFile(
      path.join(tsxDir, "dist", "cli.mjs"),
      "#!/usr/bin/env node\nconsole.log('tsx mock');"
    );

    // Test resolution
    const { createRequire } = await import("node:module");
    const projectRequire = createRequire(path.join(testDir, "package.json"));

    const tsxPkgPath = projectRequire.resolve("tsx/package.json");
    const tsxPkg = JSON.parse(await readFile(tsxPkgPath, "utf-8"));

    expect(tsxPkg.bin).toBeDefined();
    expect(typeof tsxPkg.bin).toBe("object");

    // Should use 'tsx' entry
    const binPath = tsxPkg.bin.tsx || Object.values(tsxPkg.bin)[0];
    const tsxBin = path.resolve(path.dirname(tsxPkgPath), binPath as string);

    expect(tsxBin).toContain("dist/cli.mjs");
    expect(binPath).toBe("./dist/cli.mjs");
  });

  it("should handle missing bin field gracefully", async () => {
    // Create mock tsx package.json without bin field
    const tsxDir = path.join(testDir, "node_modules", "tsx");
    await mkdir(tsxDir, { recursive: true });

    const tsxPackageJson = {
      name: "tsx",
      version: "4.0.0",
      // No bin field
    };

    await writeFile(
      path.join(tsxDir, "package.json"),
      JSON.stringify(tsxPackageJson, null, 2)
    );

    // Test resolution
    const { createRequire } = await import("node:module");
    const projectRequire = createRequire(path.join(testDir, "package.json"));

    const tsxPkgPath = projectRequire.resolve("tsx/package.json");
    const tsxPkg = JSON.parse(await readFile(tsxPkgPath, "utf-8"));

    expect(tsxPkg.bin).toBeUndefined();

    // Should throw error
    let binPath: string;
    try {
      if (typeof tsxPkg.bin === "string") {
        binPath = tsxPkg.bin;
      } else if (tsxPkg.bin && typeof tsxPkg.bin === "object") {
        binPath = tsxPkg.bin.tsx || Object.values(tsxPkg.bin)[0];
      } else {
        throw new Error("No bin field found in tsx package.json");
      }
      expect.fail("Should have thrown an error");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("No bin field found");
    }
  });

  it("should prefer 'tsx' entry in object bin field", async () => {
    const tsxDir = path.join(testDir, "node_modules", "tsx");
    await mkdir(tsxDir, { recursive: true });

    const tsxPackageJson = {
      name: "tsx",
      version: "4.0.0",
      bin: {
        "other-bin": "./dist/other.mjs",
        tsx: "./dist/cli.mjs",
        "another-bin": "./dist/another.mjs",
      },
    };

    await writeFile(
      path.join(tsxDir, "package.json"),
      JSON.stringify(tsxPackageJson, null, 2)
    );

    const { createRequire } = await import("node:module");
    const projectRequire = createRequire(path.join(testDir, "package.json"));

    const tsxPkgPath = projectRequire.resolve("tsx/package.json");
    const tsxPkg = JSON.parse(await readFile(tsxPkgPath, "utf-8"));

    // Should use 'tsx' entry specifically
    const binPath = tsxPkg.bin.tsx || Object.values(tsxPkg.bin)[0];
    expect(binPath).toBe("./dist/cli.mjs");
    expect(binPath).not.toBe("./dist/other.mjs");
  });
});
