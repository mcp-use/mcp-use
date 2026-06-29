import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  diffMcpUseProjectConfigLocal,
  loadMcpUseProjectConfig,
  resolveMcpUseWorkspacePaths,
  validateMcpUseProjectConfig,
} from "../../src/project-config.js";

describe("mcp-use project config", () => {
  it("loads mcp-use.json and resolves workspace paths", async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "mcp-use-config-"));
    await writeFile(
      path.join(projectRoot, "mcp-use.json"),
      JSON.stringify({
        version: 1,
        name: "orders",
        entry: "server.ts",
        viewsDir: "ui",
        outDir: ".mcp-use/custom-build",
        dev: { port: 4100 },
        eval: { outputDir: ".mcp-use/custom-eval" },
      })
    );

    const loaded = await loadMcpUseProjectConfig(projectRoot);
    const paths = resolveMcpUseWorkspacePaths(projectRoot, loaded.config);

    expect(loaded.source).toBe("file");
    expect(loaded.config.entry).toBe("server.ts");
    expect(loaded.config.viewsDir).toBe("ui");
    expect(loaded.config.dev.port).toBe(4100);
    expect(paths.manifestPath).toBe(
      path.join(projectRoot, ".mcp-use", "custom-build", "manifest.json")
    );
    expect(paths.toolRegistryPath).toBe(
      path.join(projectRoot, ".mcp-use", "generated", "tool-registry.d.ts")
    );
    expect(paths.tunnelStatePath).toBe(
      path.join(projectRoot, ".mcp-use", "state", "tunnel.json")
    );
    expect(paths.cloudLinkPath).toBe(
      path.join(projectRoot, ".mcp-use", "cloud", "link.json")
    );
    expect(paths.evalRunsDir).toBe(
      path.join(projectRoot, ".mcp-use", "custom-eval")
    );
  });

  it("validates malformed local config fields", async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "mcp-use-config-"));
    await writeFile(
      path.join(projectRoot, "mcp-use.json"),
      JSON.stringify({
        version: 1,
        dev: { port: "3000" },
        cloud: { region: "MARS" },
      })
    );

    const result = await validateMcpUseProjectConfig(projectRoot);

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        { path: "dev.port", message: "must be a number." },
        {
          path: "cloud.region",
          message: "must be one of AUTO, US, EU, or APAC.",
        },
      ])
    );
  });

  it("diffs committed config against local cloud link and env", async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "mcp-use-config-"));
    await writeFile(
      path.join(projectRoot, "mcp-use.json"),
      JSON.stringify({
        version: 1,
        name: "orders",
        cloud: { serverId: "srv_config", serverSlug: "orders" },
      })
    );
    await mkdir(path.join(projectRoot, ".mcp-use", "cloud"), {
      recursive: true,
    });
    await writeFile(
      path.join(projectRoot, ".mcp-use", "cloud", "link.json"),
      JSON.stringify({
        serverId: "srv_link",
        deploymentId: "dep_1",
        linkedAt: "2026-01-01T00:00:00.000Z",
      })
    );

    const diff = await diffMcpUseProjectConfigLocal(projectRoot, {
      MCP_USE_SERVER_ID: "srv_env",
    } as NodeJS.ProcessEnv);

    expect(diff.mode).toBe("local");
    expect(diff.project.name).toBe("orders");
    expect(diff.link.serverId).toBe("srv_link");
    expect(diff.env.MCP_USE_SERVER_ID.present).toBe(true);
    expect(diff.differences.map((item) => item.field)).toEqual([
      "cloud.serverId",
      "cloud.serverId",
      "link.serverId",
    ]);
  });
});
