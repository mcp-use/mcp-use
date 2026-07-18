/** e2e tests for runBuild: real Vite build of the fixture, real import. */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
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
import { mcpUseViewsPlugin } from "../../src/cli/views-plugin.js";
import { VIRTUAL_VIEW_RESOLVED_PREFIX } from "../../src/cli/views.js";
import { synthesizeViewDocument } from "../../src/views/document.js";
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

function listViewAssets(
  buildDir: string,
  viewName: string
): { entry: string; css: string[] } {
  const assetsDir = join(buildDir, "views", viewName, "assets");
  const files = readdirSync(assetsDir);
  const js = files.find(
    (file) => file.endsWith(".js") && !file.endsWith(".map.js")
  );
  if (js === undefined) {
    throw new Error(`expected JS asset for view ${viewName}`);
  }
  return {
    entry: `assets/${js}`,
    css: files
      .filter((file) => file.endsWith(".css"))
      .map((file) => `assets/${file}`),
  };
}

describe("runBuild", () => {
  it("emits an ESM bundle + manifest to .mcp-use/build and preserves the default export", async () => {
    const cwd = copyFixture("build");
    dirs.push(cwd);
    mkdirSync(join(cwd, "public"), { recursive: true });
    writeFileSync(
      join(cwd, "public", "icon.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
    );

    await runBuild({ cwd });

    const envDeclaration = readFileSync(join(cwd, "mcp-env.d.ts"), "utf8");
    expect(envDeclaration).toContain('tools: typeof import("./src/index.js")');
    expect(envDeclaration).toContain('declare module "*.css"');

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
    expect(manifest.inspector).toBe(false);
    expect("views" in manifest).toBe(false);
    expect(
      readFileSync(join(buildDir, "views", "public", "icon.svg"), "utf8")
    ).toContain("<svg");

    // packages:"external" semantics — bare imports stay external, only the
    // user's source is bundled.
    const code = readFileSync(entryFile, "utf8");
    expect(code).toMatch(/from ["']mcp-use["']/);
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
    expect(existsSync(join(cwd, WORKSPACE_DIR_NAME, "build", "index.js"))).toBe(
      true
    );
  });

  it("does not overwrite an existing mcp-env.d.ts", async () => {
    const cwd = copyFixture("build-existing-tools");
    dirs.push(cwd);
    const declarationPath = join(cwd, "mcp-env.d.ts");
    const existing = "// user-owned env declaration\nexport {};\n";
    writeFileSync(declarationPath, existing);

    await runBuild({ cwd });

    expect(readFileSync(declarationPath, "utf8")).toBe(existing);
  });

  it("fails with the candidate list when no entry exists", async () => {
    const cwd = copyFixture("build-noentry");
    dirs.push(cwd);
    removeDir(join(cwd, "src"));
    await expect(runBuild({ cwd })).rejects.toThrow(/No server entry found/);
  });
});

describe("runBuild (views)", () => {
  it("virtual entry imports the full view module for named viewConfig", () => {
    const plugin = mcpUseViewsPlugin({
      getViews: () => [
        {
          name: "demo",
          entryPath: "/abs/views/demo/view.tsx",
        },
      ],
    });
    const load = plugin.load;
    expect(load).toBeTypeOf("function");
    const source = (load as (id: string) => string | undefined)(
      `${VIRTUAL_VIEW_RESOLVED_PREFIX}demo`
    );
    expect(source).toContain(
      'import * as viewModule from "/abs/views/demo/view.tsx"'
    );
    expect(source).toContain("bootstrapView(viewModule)");
    expect(source).not.toMatch(/bootstrapView\(\s*viewModule\.default\s*\)/);
  });

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

    expect("views" in manifest).toBe(false);
    const product = listViewAssets(buildDir, "product-search-result");
    expect(product.entry).toMatch(/^assets\/.+\.js$/);
    expect(product.css).toEqual(
      expect.arrayContaining([expect.stringMatching(/^assets\/.+\.css$/)])
    );
    expect(product.entry.length).toBeGreaterThan(0);

    const assetPath = join(
      buildDir,
      "views",
      "product-search-result",
      product.entry
    );
    expect(existsSync(assetPath)).toBe(true);
    const assetJs = readFileSync(assetPath, "utf8");
    expect(assetJs).toMatch(/bootstrapView|createElement|react/i);
    if (product.css[0] !== undefined) {
      const cssPath = join(
        buildDir,
        "views",
        "product-search-result",
        product.css[0]
      );
      expect(existsSync(cssPath)).toBe(true);
      expect(readFileSync(cssPath, "utf8")).toContain("tailwindcss");
    }

    const publicFile = join(buildDir, "views", "public", "test.txt");
    expect(existsSync(publicFile)).toBe(true);
    expect(readFileSync(publicFile, "utf8")).toBe("public-fixture\n");

    const entryCode = readFileSync(join(buildDir, "index.js"), "utf8");
    expect(entryCode).toMatch(/registerViews/);
    expect(entryCode).toMatch(/"kind"\s*:\s*"external"/);
    expect(entryCode.length).toBeLessThan(100_000);
    expect(entryCode).not.toContain(assetJs.slice(0, 40));

    const previousCwd = process.cwd();
    process.chdir(cwd);
    try {
      const mod = (await import(
        pathToFileURL(join(buildDir, "index.js")).href
      )) as {
        default: { getHandler(): (request: Request) => Promise<Response> };
      };
      const handler = mod.default.getHandler();

      const listBody = await handlerMcp(handler, "resources/list");
      const resources = (listBody["result"] as { resources: { uri: string }[] })
        .resources;
      expect(
        resources.some((r) => r.uri === "ui://views/product-search-result.html")
      ).toBe(true);

      const readBody = await handlerMcp(handler, "resources/read", {
        uri: "ui://views/product-search-result.html",
      });
      const text = (readBody["result"] as { contents: { text: string }[] })
        .contents[0]!.text;
      expect(text).toContain('id="root"');
      expect(text).toMatch(/<script type="module" src="/);
      expect(text).toContain("/mcp/_mcp-use/views/product-search-result/");
      expect(text).toContain(product.entry);
      expect(text).not.toMatch(/<script type="module">[\s\S]{80,}/);
      if (product.css.length > 0) {
        expect(text).toMatch(/<link rel="stylesheet" href="/);
      }

      const assetUrlMatch = text.match(/<script type="module" src="([^"]+)"/);
      expect(assetUrlMatch).not.toBeNull();
      const assetResponse = await handler(new Request(assetUrlMatch![1]!));
      expect(assetResponse.status).toBe(200);
      expect(assetResponse.headers.get("content-type")).toContain("javascript");
      expect(await assetResponse.text()).toMatch(
        /bootstrapView|createElement|react/i
      );

      const publicOk = await handler(
        new Request("http://localhost/mcp/_mcp-use/public/test.txt")
      );
      expect(publicOk.status).toBe(200);
      expect(publicOk.headers.get("cache-control")).toBe(
        "public, max-age=0, must-revalidate"
      );
      expect(await publicOk.text()).toBe("public-fixture\n");

      const publicTraversal = await handler(
        new Request("http://localhost/mcp/_mcp-use/public/../index.js")
      );
      expect(publicTraversal.status).toBe(404);

      const readProxied = await handlerMcp(
        handler,
        "resources/read",
        { uri: "ui://views/product-search-result.html" },
        {
          "x-forwarded-proto": "https",
          "x-forwarded-host": "fruit.example.com",
        }
      );
      const proxiedReadContent = (
        readProxied["result"] as {
          contents: {
            text: string;
            _meta?: { ui?: { csp?: { resourceDomains?: string[] } } };
          }[];
        }
      ).contents[0]!;
      expect(proxiedReadContent.text).toContain(
        "https://fruit.example.com/mcp/_mcp-use/public/"
      );
      expect(proxiedReadContent.text).toMatch(/<script type="module" src="/);
      expect(proxiedReadContent.text).toContain(
        "https://fruit.example.com/mcp/_mcp-use/views/product-search-result/"
      );
      const readResourceDomains =
        proxiedReadContent._meta?.ui?.csp?.resourceDomains;
      expect(readResourceDomains).toContain("https://images.example.com");
      expect(readResourceDomains).toContain("https://fruit.example.com");

      const listMeta = await handlerMcp(handler, "resources/list");
      const viewResource = (
        listMeta["result"] as {
          resources: {
            uri: string;
            description?: string;
            _meta?: { ui?: { csp?: unknown } };
          }[];
        }
      ).resources.find(
        (r) => r.uri === "ui://views/product-search-result.html"
      );
      const resourceDomains = (
        viewResource?._meta?.ui as { csp?: { resourceDomains?: string[] } }
      )?.csp?.resourceDomains;
      expect(resourceDomains).toContain("https://images.example.com");
      expect(resourceDomains?.some((d) => d.includes("localhost"))).toBe(true);
      expect(viewResource?.description).toBe("Product search results grid");
    } finally {
      process.chdir(previousCwd);
    }
  }, 60_000);

  it("escapes </script> in legacy inline module source", () => {
    const html = synthesizeViewDocument(
      {
        kind: "inline",
        js: 'const s = "</script>"; console.log(s);',
        css: "",
      },
      "https://example.com",
      "/mcp"
    );
    const moduleMatch = html.match(
      /<script type="module">([\s\S]*?)<\/script>\s*<\/body>/
    );
    expect(moduleMatch).not.toBeNull();
    const body = moduleMatch![1]!;
    expect(body).not.toContain("</script>");
    expect(body).toContain("<\\/script>");
  });

  it("builds a view that contains </script> in source as external assets", async () => {
    const cwd = copyFixture("build-views-escape", "views");
    dirs.push(cwd);
    mkdirSync(join(cwd, "views", "escape-view"), { recursive: true });
    writeFileSync(
      join(cwd, "views", "escape-view", "view.tsx"),
      [
        `const marker = "</script>";`,
        `export default function EscapeView() {`,
        `  return <div data-marker={marker}>ok</div>;`,
        `}`,
        ``,
      ].join("\n")
    );
    const entry = join(cwd, "src", "index.ts");
    const source = readFileSync(entry, "utf8");
    writeFileSync(
      entry,
      source.replace('name: "product-search-result"', 'name: "escape-view"')
    );

    await runBuild({ cwd });

    const buildDir = join(cwd, WORKSPACE_DIR_NAME, "build");
    expect(listViewAssets(buildDir, "escape-view").entry).toMatch(
      /^assets\/.+\.js$/
    );
  }, 60_000);

  it("records inspector: true when built with --with-inspector", async () => {
    const cwd = copyFixture("build");
    dirs.push(cwd);

    await runBuild({ cwd, withInspector: true });

    const manifest = JSON.parse(
      readFileSync(
        join(cwd, WORKSPACE_DIR_NAME, "build", BUILD_MANIFEST_NAME),
        "utf8"
      )
    ) as BuildManifest;
    expect(manifest.inspector).toBe(true);
    expect("views" in manifest).toBe(false);
  });

  it("builds a view module that uses browser globals at module scope", async () => {
    const cwd = copyFixture("build-views-browser", "views");
    dirs.push(cwd);
    mkdirSync(join(cwd, "views", "browser-view"), { recursive: true });
    writeFileSync(
      join(cwd, "views", "browser-view", "view.tsx"),
      `const x = window.location.href;\nexport default function B() { return null; }\n`
    );
    await expect(runBuild({ cwd })).resolves.toBeUndefined();
  }, 60_000);

  it("fails when a tool binds a missing view", async () => {
    const cwd = copyFixture("build-views-missing", "views");
    dirs.push(cwd);
    const entry = join(cwd, "src", "index.ts");
    const source = readFileSync(entry, "utf8");
    writeFileSync(
      entry,
      source.replace('name: "product-search-result"', 'name: "does-not-exist"')
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

  it("rewrites manifest asset paths when MCP_ASSETS_URL is set", async () => {
    const cwd = copyFixture("build-views-cdn", "views");
    dirs.push(cwd);
    const previous = process.env.MCP_ASSETS_URL;
    process.env.MCP_ASSETS_URL =
      "https://cdn.example.com/storage/v1/object/public/widgets";
    try {
      await runBuild({ cwd });
      const buildDir = join(cwd, WORKSPACE_DIR_NAME, "build");
      const entryCode = readFileSync(join(buildDir, "index.js"), "utf8");
      expect(entryCode).toContain("https://cdn.example.com");
      expect(entryCode).toContain(
        "/mcp/_mcp-use/views/product-search-result/assets/"
      );
    } finally {
      if (previous === undefined) {
        delete process.env.MCP_ASSETS_URL;
      } else {
        process.env.MCP_ASSETS_URL = previous;
      }
    }
  }, 60_000);

  it("uses server basePath in CDN manifest when MCP_ASSETS_URL is set", async () => {
    const cwd = copyFixture("build-views-cdn-basepath", "views");
    dirs.push(cwd);
    const indexPath = join(cwd, "src/index.ts");
    writeFileSync(
      indexPath,
      readFileSync(indexPath, "utf8").replace(
        'new MCPServer({ name: "fixture-views", version: "1.0.0" })',
        'new MCPServer({ name: "fixture-views", version: "1.0.0", basePath: "/api/mcp" })'
      )
    );
    const previous = process.env.MCP_ASSETS_URL;
    process.env.MCP_ASSETS_URL =
      "https://cdn.example.com/storage/v1/object/public/widgets";
    try {
      await runBuild({ cwd });
      const buildDir = join(cwd, WORKSPACE_DIR_NAME, "build");
      const entryCode = readFileSync(join(buildDir, "index.js"), "utf8");
      expect(entryCode).toContain(
        "https://cdn.example.com/storage/v1/object/public/widgets/api/mcp/_mcp-use/views/product-search-result/assets/"
      );
      expect(entryCode).not.toContain(
        "https://cdn.example.com/storage/v1/object/public/widgets/mcp/_mcp-use/"
      );
    } finally {
      if (previous === undefined) {
        delete process.env.MCP_ASSETS_URL;
      } else {
        process.env.MCP_ASSETS_URL = previous;
      }
    }
  }, 60_000);
});
