/** e2e tests for runBuild: real Vite build of the fixture, real import. */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";

import {
  BUILD_MANIFEST_NAME,
  runBuild,
  WORKSPACE_DIR_NAME,
  type BuildManifest,
} from "../../src/cli/index.js";
import { copyFixture, removeDir } from "./helpers.js";

const UI_META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": { name: "cli-test", version: "0.0.0" },
  "io.modelcontextprotocol/clientCapabilities": {
    extensions: {
      "io.modelcontextprotocol/ui": {
        mimeTypes: ["text/html;profile=mcp-app"],
      },
    },
  },
};

async function handlerMcp(
  handler: (request: Request) => Promise<Response>,
  method: string,
  params: Record<string, unknown> = {},
  requestHeaders: Record<string, string> = {}
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": "2026-07-28",
    "mcp-method": method,
    ...requestHeaders,
  };
  if (typeof params["name"] === "string") {
    headers["mcp-name"] = params["name"];
  } else if (typeof params["uri"] === "string") {
    headers["mcp-name"] = params["uri"];
  }
  const response = await handler(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params: { ...params, _meta: UI_META },
      }),
    })
  );
  return (await response.json()) as Record<string, unknown>;
}

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

describe("runBuild (views)", () => {
  it("builds views manifest, assets, wrapper entry, and binding checks", async () => {
    const cwd = copyFixture("build-views", "views");
    dirs.push(cwd);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await runBuild({ cwd });
    expect(
      warnSpy.mock.calls.some((call) =>
        String(call[0]).includes('View "orphan-preview"')
      )
    ).toBe(true);
    warnSpy.mockRestore();

    const buildDir = join(cwd, WORKSPACE_DIR_NAME, "build");
    const manifest = JSON.parse(
      readFileSync(join(buildDir, BUILD_MANIFEST_NAME), "utf8")
    ) as BuildManifest;

    expect(manifest.views).toBeDefined();
    const views = manifest.views!;
    expect(views["product-search-result"]).toMatchObject({
      metadata: {
        description: "Product search results grid",
        prefersBorder: true,
      },
    });
    expect(views["product-search-result"]!.entry).toMatch(
      /^views\/assets\/product-search-result-[^/]+\.js$/
    );
    for (const css of views["product-search-result"]!.css) {
      expect(css).toMatch(/^views\/assets\/[^/]+\.css$/);
    }

    const assetsDir = join(buildDir, "views", "assets");
    const assetFiles = readdirSync(assetsDir);
    expect(assetFiles.some((f) => f.endsWith(".js"))).toBe(true);
    expect(assetFiles.some((f) => f.endsWith(".html"))).toBe(false);

    const entryCode = readFileSync(join(buildDir, "index.js"), "utf8");
    expect(entryCode).toMatch(/registerViews/);

    const previousCwd = process.cwd();
    process.chdir(cwd);
    try {
      const mod = (await import(pathToFileURL(join(buildDir, "index.js")).href)) as {
        default: { getHandler(): (request: Request) => Promise<Response> };
      };
      const handler = mod.default.getHandler();

      const assetsBackup = join(buildDir, "views-assets-backup");
      renameSync(join(buildDir, "views"), assetsBackup);

      const listBody = await handlerMcp(handler, "resources/list");
      const resources = (listBody["result"] as { resources: { uri: string }[] })
        .resources;
      expect(
        resources.some((r) => r.uri === "ui://views/product-search-result.html")
      ).toBe(true);

      const readBody = await handlerMcp(handler, "resources/read", {
        uri: "ui://views/product-search-result.html",
      });
      const text = (
        readBody["result"] as { contents: { text: string }[] }
      ).contents[0]!.text;
      expect(text).toContain('id="root"');
      expect(text).toMatch(/product-search-result-[^"]+\.js/);

      const docResponse = await handler(
        new Request(
          "http://localhost/mcp/_mcp-use/views/product-search-result.html"
        )
      );
      expect(docResponse.status).toBe(200);
      expect(docResponse.headers.get("cache-control")).toBe("no-store");

      const assetName = views["product-search-result"]!.entry.split("/").pop()!;
      const assetResponse = await handler(
        new Request(`http://localhost/mcp/_mcp-use/assets/${assetName}`)
      );
      expect(assetResponse.status).toBe(404);

      renameSync(assetsBackup, join(buildDir, "views"));
      const assetOk = await handler(
        new Request(`http://localhost/mcp/_mcp-use/assets/${assetName}`)
      );
      expect(assetOk.status).toBe(200);
      expect(assetOk.headers.get("cache-control")).toContain("immutable");

      const proxied = await handler(
        new Request(
          "http://localhost/mcp/_mcp-use/views/product-search-result.html",
          {
            headers: {
              "x-forwarded-proto": "https",
              "x-forwarded-host": "fruit.example.com",
            },
          }
        )
      );
      const proxiedHtml = await proxied.text();
      expect(proxiedHtml).toContain(
        "https://fruit.example.com/mcp/_mcp-use/assets/"
      );

      const readProxied = await handlerMcp(
        handler,
        "resources/read",
        { uri: "ui://views/product-search-result.html" },
        {
          "x-forwarded-proto": "https",
          "x-forwarded-host": "fruit.example.com",
        }
      );
      const proxiedRead = (
        readProxied["result"] as { contents: { text: string }[] }
      ).contents[0]!.text;
      expect(proxiedRead).toContain(
        "https://fruit.example.com/mcp/_mcp-use/assets/"
      );

      const listMeta = await handlerMcp(handler, "resources/list");
      const viewResource = (
        listMeta["result"] as {
          resources: { uri: string; _meta?: { ui?: { csp?: unknown } } }[];
        }
      ).resources.find((r) => r.uri === "ui://views/product-search-result.html");
      const resourceDomains = (
        viewResource?._meta?.ui as { csp?: { resourceDomains?: string[] } }
      )?.csp?.resourceDomains;
      expect(resourceDomains).toContain("https://images.example.com");
      expect(resourceDomains?.some((d) => d.includes("localhost"))).toBe(true);
    } finally {
      process.chdir(previousCwd);
    }
  }, 60_000);

  it("fails the build when a view module is node-incompatible", async () => {
    const cwd = copyFixture("build-views-bad", "views");
    dirs.push(cwd);
    mkdirSync(join(cwd, "resources", "broken-view"), { recursive: true });
    writeFileSync(
      join(cwd, "resources", "broken-view", "view.tsx"),
      `const x = window.location.href;\nexport default function B() { return null; }\n`
    );
    await expect(runBuild({ cwd })).rejects.toThrow(/view "broken-view"/i);
  }, 60_000);

  it("fails when a tool binds a missing view", async () => {
    const cwd = copyFixture("build-views-missing", "views");
    dirs.push(cwd);
    const entry = join(cwd, "src", "index.ts");
    const source = readFileSync(entry, "utf8");
    writeFileSync(
      entry,
      source.replace(
        'view: { name: "product-search-result" }',
        'view: { name: "does-not-exist" }'
      )
    );
    await expect(runBuild({ cwd })).rejects.toThrow(/does-not-exist/);
  }, 60_000);

  it("warns on unbound views but still succeeds", async () => {
    const cwd = copyFixture("build-views-warn", "views");
    dirs.push(cwd);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await runBuild({ cwd });
    expect(
      warnSpy.mock.calls.some((call) =>
        String(call[0]).includes("orphan-preview")
      )
    ).toBe(true);
    warnSpy.mockRestore();
  }, 60_000);
});
