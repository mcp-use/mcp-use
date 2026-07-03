/** e2e tests for runBuild: real Vite build of the fixture, real import. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import {
  BUILD_MANIFEST_NAME,
  runBuild,
  WORKSPACE_DIR_NAME,
  type BuildManifest,
} from "../../src/cli/index.js";
import { copyFixture, removeDir } from "./helpers.js";

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) removeDir(dir);
});

describe("runBuild", () => {
  it("emits an ESM bundle + manifest to .mcp-use/build and preserves the default export", async () => {
    const cwd = copyFixture("build");
    dirs.push(cwd);

    await runBuild({ cwd });

    const buildDir = join(cwd, WORKSPACE_DIR_NAME, "build");
    const entryFile = join(buildDir, "index.js");
    expect(existsSync(entryFile)).toBe(true);
    expect(existsSync(`${entryFile}.map`)).toBe(true);

    // Manifest shape per CLI_SPEC.md § Commands → build.
    const manifest = JSON.parse(
      readFileSync(join(buildDir, BUILD_MANIFEST_NAME), "utf8")
    ) as BuildManifest;
    expect(manifest.entryPoint).toBe("index.js");
    expect(manifest.buildId).toMatch(/^[0-9a-f]{16}$/);
    expect(new Date(manifest.createdAt).getTime()).not.toBeNaN();
    expect(manifest.inspector).toBe(true);

    // packages:"external" semantics — bare imports stay external, only the
    // user's source is bundled.
    const code = readFileSync(entryFile, "utf8");
    expect(code).toMatch(/from ["']@mcp-use\/server["']/);
    expect(code).toMatch(/from ["']zod["']/);

    // The built entry runs under plain node and default-exports the
    // MCPServer instance (getHandler present); drive a real request through
    // the handler to prove the export is live.
    const mod = (await import(pathToFileURL(entryFile).href)) as {
      default: { getHandler(): (request: Request) => Promise<Response> };
    };
    expect(typeof mod.default.getHandler).toBe("function");

    const handler = mod.default.getHandler();
    const response = await handler(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2026-07-28",
          "mcp-method": "tools/call",
          "mcp-name": "add",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "add",
            arguments: { a: 1, b: 2 },
            _meta: {
              "io.modelcontextprotocol/protocolVersion": "2026-07-28",
              "io.modelcontextprotocol/clientInfo": {
                name: "cli-test",
                version: "0.0.0",
              },
              "io.modelcontextprotocol/clientCapabilities": {},
            },
          },
        }),
      })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      result: { content: [{ type: "text", text: "3" }] },
    });
  });

  it("honors an --entry override", async () => {
    const cwd = copyFixture("build-entry");
    dirs.push(cwd);
    await runBuild({ cwd, entry: "src/index.ts" });
    expect(
      existsSync(join(cwd, WORKSPACE_DIR_NAME, "build", "index.js"))
    ).toBe(true);
  });

  it("fails with the candidate list when no entry exists", async () => {
    const cwd = copyFixture("build-noentry");
    dirs.push(cwd);
    removeDir(join(cwd, "src"));
    await expect(runBuild({ cwd })).rejects.toThrow(/No server entry found/);
  });
});
