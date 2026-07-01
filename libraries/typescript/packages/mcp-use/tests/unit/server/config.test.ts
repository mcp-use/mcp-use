/**
 * Tests for the mcp-use.config.json project config: Zod schema defaults/validation and
 * the zero-execution loader (walk-up resolution, missing-file defaults, error
 * paths). These exercise real files on disk in temp directories — no mocks.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ConfigError,
  CONFIG_SCHEMA_URL,
  configSchema,
  loadConfig,
} from "../../../src/server/config/index.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mcp-use-config-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeConfig(dir: string, contents: unknown | string): string {
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, "mcp-use.config.json");
  const raw =
    typeof contents === "string" ? contents : JSON.stringify(contents, null, 2);
  writeFileSync(filePath, raw);
  return filePath;
}

describe("configSchema defaults", () => {
  it("applies all defaults when given an empty object", () => {
    const config = configSchema.parse({});

    expect(config.version).toBe(1);
    expect(config.viewsDir).toBe("resources");
    expect(config.publicDir).toBe("public");
    expect(config.outDir).toBe(".mcp-use/build");
    expect(config.basePath).toBe("/mcp");
    expect(config.assetPrefix).toBeNull();

    // Optional fields with no default stay undefined.
    expect(config.name).toBeUndefined();
    expect(config.entry).toBeUndefined();

    // Nested objects default to a fully-populated object.
    expect(config.dev).toEqual({
      port: 3000,
      host: "localhost",
      openInspector: true,
      tunnel: false,
    });
    expect(config.build).toEqual({
      command: "mcp-use build",
      startCommand: "mcp-use start",
      port: 3000,
      inline: false,
      typecheck: true,
    });
    expect(config.cloud).toEqual({
      serverSlug: null,
      serverId: null,
      organization: null,
      region: "AUTO",
      productionBranch: "main",
      watchPaths: ["src/**", "resources/**"],
      deployBranchPatterns: ["feature/*"],
      waitForCi: false,
    });
    expect(config.env).toEqual({ files: [".env"], syncOnDeploy: [] });
    expect(config.eval).toEqual({
      specs: ["evals/**/*.yaml"],
      defaultRunner: "local",
      baselineDir: "evals/baselines",
      outputDir: ".mcp-use/eval/runs",
    });
  });

  it("fills missing keys inside a partially-specified nested object", () => {
    const config = configSchema.parse({ dev: { port: 4000 } });

    expect(config.dev).toEqual({
      port: 4000,
      host: "localhost",
      openInspector: true,
      tunnel: false,
    });
  });

  it("preserves explicit values over defaults", () => {
    const config = configSchema.parse({
      name: "orders",
      entry: "src/index.ts",
      viewsDir: "views",
      assetPrefix: "https://cdn.example.com",
      dev: { port: 8080, host: "0.0.0.0", openInspector: false, tunnel: true },
    });

    expect(config.name).toBe("orders");
    expect(config.entry).toBe("src/index.ts");
    expect(config.viewsDir).toBe("views");
    expect(config.assetPrefix).toBe("https://cdn.example.com");
    expect(config.dev.port).toBe(8080);
    expect(config.dev.tunnel).toBe(true);
  });

  it("accepts the $schema and version keys", () => {
    const config = configSchema.parse({
      $schema: CONFIG_SCHEMA_URL,
      version: 1,
    });

    expect(config.$schema).toBe(CONFIG_SCHEMA_URL);
    expect(config.version).toBe(1);
  });

  it("rejects unknown top-level keys", () => {
    const result = configSchema.safeParse({ viewDir: "resources" });

    expect(result.success).toBe(false);
    if (!result.success) {
      const message = JSON.stringify(result.error.issues);
      expect(message).toContain("viewDir");
    }
  });

  it("rejects a wrong field type", () => {
    const result = configSchema.safeParse({ dev: { port: "nope" } });

    expect(result.success).toBe(false);
  });
});

describe("loadConfig", () => {
  it("returns defaults with configPath null when no file is found", async () => {
    const emptyDir = join(root, "no-config-here");
    mkdirSync(emptyDir, { recursive: true });

    const result = await loadConfig({ cwd: emptyDir });

    expect(result.configPath).toBeNull();
    expect(result.projectRoot).toBe(emptyDir);
    expect(result.config).toEqual(configSchema.parse({}));
  });

  it("loads a config in the starting directory", async () => {
    const configPath = writeConfig(root, { name: "orders" });

    const result = await loadConfig({ cwd: root });

    expect(result.configPath).toBe(configPath);
    expect(result.projectRoot).toBe(root);
    expect(result.config.name).toBe("orders");
    // Defaults still applied alongside explicit values.
    expect(result.config.viewsDir).toBe("resources");
  });

  it("walks up to find a config in a parent directory", async () => {
    const configPath = writeConfig(root, { name: "monorepo-root" });
    const deep = join(root, "packages", "app", "src");
    mkdirSync(deep, { recursive: true });

    const result = await loadConfig({ cwd: deep });

    expect(result.configPath).toBe(configPath);
    expect(result.projectRoot).toBe(root);
    expect(result.config.name).toBe("monorepo-root");
  });

  it("stops at the nearest config when nested configs exist", async () => {
    writeConfig(root, { name: "outer" });
    const innerDir = join(root, "packages", "inner");
    const innerPath = writeConfig(innerDir, { name: "inner" });
    const deep = join(innerDir, "src");
    mkdirSync(deep, { recursive: true });

    const result = await loadConfig({ cwd: deep });

    expect(result.configPath).toBe(innerPath);
    expect(result.projectRoot).toBe(innerDir);
    expect(result.config.name).toBe("inner");
  });

  it("throws a ConfigError naming the path on invalid JSON", async () => {
    const configPath = writeConfig(root, "{ not valid json ");

    await expect(loadConfig({ cwd: root })).rejects.toThrowError(ConfigError);
    await expect(loadConfig({ cwd: root })).rejects.toThrow(configPath);
  });

  it("throws a ConfigError naming the offending field on schema violation", async () => {
    const configPath = writeConfig(root, { dev: { port: "nope" } });

    let error: unknown;
    try {
      await loadConfig({ cwd: root });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ConfigError);
    const configError = error as ConfigError;
    expect(configError.configPath).toBe(configPath);
    expect(configError.message).toContain(configPath);
    expect(configError.message).toContain("dev.port");
  });

  it("throws a ConfigError on an unknown top-level key", async () => {
    writeConfig(root, { viewDir: "resources" });

    await expect(loadConfig({ cwd: root })).rejects.toThrow(/viewDir/);
  });

  it("accepts a config carrying $schema and version", async () => {
    writeConfig(root, { $schema: CONFIG_SCHEMA_URL, version: 1, name: "x" });

    const result = await loadConfig({ cwd: root });

    expect(result.config.$schema).toBe(CONFIG_SCHEMA_URL);
    expect(result.config.version).toBe(1);
    expect(result.config.name).toBe("x");
  });

  it("loads without an explicit cwd (defaults to process cwd)", async () => {
    // Just verify it resolves and never throws when run from the repo, which
    // has no mcp-use.config.json above it inside the worktree boundary we control.
    const result = await loadConfig();
    expect(result.config.version).toBe(1);
    expect(typeof result.projectRoot).toBe("string");
  });
});
