/**
 * Tests for the `.mcp-use/` workspace path derivation: the pure
 * `resolveWorkspacePaths` deriver and the `resolveWorkspace` load+derive
 * one-shot (exercised against real config files in temp dirs — no mocks).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BUILD_MANIFEST_NAME,
  resolveWorkspace,
  resolveWorkspacePaths,
  WORKSPACE_DIR_NAME,
} from "../../../src/server/config/paths.js";

describe("resolveWorkspacePaths", () => {
  it("derives the full layout from a root + the default outDir", () => {
    const p = resolveWorkspacePaths("/projects/orders", ".mcp-use/build");

    expect(p.projectRoot).toBe("/projects/orders");
    expect(p.workspace).toBe("/projects/orders/.mcp-use");
    expect(p.build).toBe("/projects/orders/.mcp-use/build");
    expect(p.generated).toBe("/projects/orders/.mcp-use/generated");
    expect(p.cache).toBe("/projects/orders/.mcp-use/cache");
    expect(p.state).toBe("/projects/orders/.mcp-use/state");
    expect(p.cloud).toBe("/projects/orders/.mcp-use/cloud");

    expect(p.buildManifest).toBe(
      "/projects/orders/.mcp-use/build/manifest.json"
    );
    expect(p.toolRegistry).toBe(
      "/projects/orders/.mcp-use/generated/tool-registry.d.ts"
    );
    expect(p.viewProps).toBe(
      "/projects/orders/.mcp-use/generated/view-props.d.ts"
    );
    expect(p.sessions).toBe("/projects/orders/.mcp-use/state/sessions.json");
    expect(p.tunnel).toBe("/projects/orders/.mcp-use/state/tunnel.json");
    expect(p.cloudLink).toBe("/projects/orders/.mcp-use/cloud/link.json");
  });

  it("honors a custom outDir while keeping non-build dirs under .mcp-use/", () => {
    const p = resolveWorkspacePaths("/p", "dist");

    // Build output follows outDir, even outside .mcp-use/.
    expect(p.build).toBe("/p/dist");
    expect(p.buildManifest).toBe("/p/dist/manifest.json");

    // State/generated/cache/cloud stay fixed under .mcp-use/.
    expect(p.workspace).toBe("/p/.mcp-use");
    expect(p.generated).toBe("/p/.mcp-use/generated");
    expect(p.cache).toBe("/p/.mcp-use/cache");
    expect(p.state).toBe("/p/.mcp-use/state");
    expect(p.cloud).toBe("/p/.mcp-use/cloud");
  });

  it("defaults outDir to .mcp-use/build when omitted", () => {
    const p = resolveWorkspacePaths("/p");

    expect(p.build).toBe("/p/.mcp-use/build");
    // Fixed dirs match the explicit-default case exactly.
    expect(p.generated).toBe("/p/.mcp-use/generated");
    expect(p.state).toBe("/p/.mcp-use/state");
  });

  it("exposes the canonical workspace + manifest names", () => {
    expect(WORKSPACE_DIR_NAME).toBe(".mcp-use");
    expect(BUILD_MANIFEST_NAME).toBe("manifest.json");
  });
});

describe("resolveWorkspace", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "mcp-use-ws-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("derives paths from defaults when no config file exists", async () => {
    const dir = join(root, "app");
    mkdirSync(dir, { recursive: true });

    const ws = await resolveWorkspace({ cwd: dir });

    expect(ws.configPath).toBeNull();
    expect(ws.projectRoot).toBe(dir);
    expect(ws.config.outDir).toBe(".mcp-use/build");
    expect(ws.paths.build).toBe(join(dir, ".mcp-use", "build"));
    expect(ws.paths.sessions).toBe(
      join(dir, ".mcp-use", "state", "sessions.json")
    );
  });

  it("derives the build dir from a custom outDir in mcp-use.config.json", async () => {
    writeFileSync(
      join(root, "mcp-use.config.json"),
      JSON.stringify({ outDir: "dist" })
    );

    const ws = await resolveWorkspace({ cwd: root });

    expect(ws.config.outDir).toBe("dist");
    expect(ws.paths.build).toBe(join(root, "dist"));
    expect(ws.paths.buildManifest).toBe(join(root, "dist", "manifest.json"));
    // Workspace-fixed dirs are unaffected by outDir.
    expect(ws.paths.state).toBe(join(root, ".mcp-use", "state"));
  });

  it("roots the workspace at the directory containing mcp-use.config.json", async () => {
    writeFileSync(
      join(root, "mcp-use.config.json"),
      JSON.stringify({ name: "x" })
    );
    const deep = join(root, "packages", "app", "src");
    mkdirSync(deep, { recursive: true });

    const ws = await resolveWorkspace({ cwd: deep });

    expect(ws.projectRoot).toBe(root);
    expect(ws.paths.workspace).toBe(join(root, ".mcp-use"));
  });
});
