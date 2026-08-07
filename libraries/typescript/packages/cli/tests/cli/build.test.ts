/** e2e tests for runBuild: real Vite build of the fixture, real import. */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
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
import { bindBasicToolToView, copyFixture, removeDir } from "./helpers.js";

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
): { entry: string; css: string[]; js: string[] } {
  const assetsDir = join(buildDir, "views", viewName, "assets");
  const files = readdirSync(assetsDir);
  const jsFiles = files.filter(
    (file) => file.endsWith(".js") && !file.endsWith(".map.js")
  );
  const entryBasename = jsFiles.find((file) => file.startsWith(`${viewName}-`));
  if (entryBasename === undefined) {
    throw new Error(`expected entry chunk for view ${viewName}`);
  }
  return {
    entry: `assets/${entryBasename}`,
    css: files
      .filter((file) => file.endsWith(".css"))
      .map((file) => `assets/${file}`),
    js: jsFiles.map((file) => `assets/${file}`),
  };
}

describe("runBuild", () => {
  it("embeds skills so the built server survives source removal", async () => {
    const cwd = copyFixture("build-skills");
    dirs.push(cwd);
    const skillDir = join(cwd, "skills", "refunds");
    mkdirSync(join(skillDir, "references"), { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      "---\nname: refunds\ndescription: Process refunds safely\n---\n# Refunds\n"
    );
    writeFileSync(join(skillDir, "references", "policy.md"), "Policy v1\n");

    await runBuild({ cwd });
    rmSync(join(cwd, "skills"), { recursive: true, force: true });

    const entryFile = join(cwd, WORKSPACE_DIR_NAME, "build", "index.js");
    const mod = (await import(`${pathToFileURL(entryFile).href}?skills=1`)) as {
      default: { fetch(request: Request): Promise<Response> };
    };
    expect(await handlerMcp(mod.default.fetch, "skills/list")).toMatchObject({
      result: { skills: [{ uri: "skill://refunds/SKILL.md" }] },
    });
    expect(
      await handlerMcp(mod.default.fetch, "resources/read", {
        uri: "skill://refunds/references/policy.md",
      })
    ).toMatchObject({
      result: { contents: [{ text: "Policy v1\n" }] },
    });
  });

  it("strictly rejects invalid skills during a production build", async () => {
    const cwd = copyFixture("build-skills");
    dirs.push(cwd);
    const skillDir = join(cwd, "skills", "refunds");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      "---\nname: not-refunds\ndescription: Invalid\n---\n"
    );

    await expect(runBuild({ cwd })).rejects.toThrow(
      /frontmatter name must match its parent directory/
    );
  });

  it("emits an ESM bundle + manifest to .mcp-use/build and preserves the default export", async () => {
    const cwd = copyFixture("build");
    dirs.push(cwd);
    mkdirSync(join(cwd, "public"), { recursive: true });
    writeFileSync(
      join(cwd, "public", "icon.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
    );

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await runBuild({ cwd });
      expect(
        logSpy.mock.calls.some(
          (call) =>
            call.length === 1 &&
            call[0] === "[mcp-use] views directory not configured."
        )
      ).toBe(true);
    } finally {
      logSpy.mockRestore();
    }

    const envDeclaration = readFileSync(join(cwd, "mcp-env.d.ts"), "utf8");
    expect(envDeclaration).toContain('tools: typeof import("./src/index.js")');
    expect(envDeclaration).toContain('import "mcp-use/vite-client"');

    const buildDir = join(cwd, WORKSPACE_DIR_NAME, "build");
    const entryFile = join(buildDir, "index.js");
    expect(existsSync(entryFile)).toBe(true);
    expect(existsSync(`${entryFile}.map`)).toBe(false);

    // Manifest shape per CLI_SPEC.md § Commands → build.
    const manifest = JSON.parse(
      readFileSync(join(buildDir, BUILD_MANIFEST_NAME), "utf8")
    ) as BuildManifest;
    expect(manifest.entryPoint).toBe("index.js");
    expect(manifest.buildId).toMatch(/^[0-9a-f]{16}$/);
    expect(new Date(manifest.createdAt).getTime()).not.toBeNaN();
    expect(manifest.views).toEqual({});
    expect(
      readFileSync(join(buildDir, "views", "public", "icon.svg"), "utf8")
    ).toContain("<svg");
    expect(existsSync(join(buildDir, "icon.svg"))).toBe(false);

    // packages:"external" semantics — bare imports stay external, only the
    // user's source is bundled.
    const code = readFileSync(entryFile, "utf8");
    expect(code).toMatch(/from ["']mcp-use["']/);
    expect(code).toMatch(/from ["']zod["']/);

    // The built entry runs under plain node and default-exports the
    // MCPServer instance (`fetch` present); drive a real request through
    // the handler to prove the export is live.
    const mod = (await import(pathToFileURL(entryFile).href)) as {
      default: { fetch(request: Request): Promise<Response> };
    };
    expect(typeof mod.default.fetch).toBe("function");

    const handler = mod.default.fetch;
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

  it.each([
    ["an empty views directory", false],
    ["a view directory without a React component", true],
  ])("builds a tool-only server with %s", async (_label, nestedDirectory) => {
    const cwd = copyFixture(`build-zero-views-${String(nestedDirectory)}`);
    dirs.push(cwd);
    const viewsDir = nestedDirectory
      ? join(cwd, "views", "unfinished")
      : join(cwd, "views");
    mkdirSync(viewsDir, { recursive: true });

    await expect(runBuild({ cwd })).resolves.toBeUndefined();
    const manifest = JSON.parse(
      readFileSync(
        join(cwd, WORKSPACE_DIR_NAME, "build", BUILD_MANIFEST_NAME),
        "utf8"
      )
    ) as BuildManifest;
    expect(manifest.views).toEqual({});
  });

  it("fails precisely when a tool binds a view and no view component exists", async () => {
    const cwd = copyFixture("build-zero-views-bound");
    dirs.push(cwd);
    mkdirSync(join(cwd, "views", "unfinished"), { recursive: true });
    bindBasicToolToView(cwd, "does-not-exist");

    let error: unknown;
    try {
      await runBuild({ cwd });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain(
      'Tool "add" is bound to view "does-not-exist" which is not in the primed views registry.'
    );
    expect(String(error)).not.toContain("no views were primed");
  });

  it("honors an --entry override", async () => {
    const cwd = copyFixture("build-entry");
    dirs.push(cwd);
    await runBuild({ cwd, entry: "src/index.ts" });
    expect(existsSync(join(cwd, WORKSPACE_DIR_NAME, "build", "index.js"))).toBe(
      true
    );
  });

  it("discovers the entry in --mcp-dir while keeping build output at the project root", async () => {
    const cwd = copyFixture("build-mcp-dir");
    dirs.push(cwd);
    mkdirSync(join(cwd, "src", "mcp"), { recursive: true });
    writeFileSync(
      join(cwd, "src", "mcp", "server.ts"),
      readFileSync(join(cwd, "src", "index.ts"), "utf8")
    );
    removeDir(join(cwd, "src", "index.ts"));

    await runBuild({ cwd, mcpDir: "src/mcp" });

    expect(existsSync(join(cwd, WORKSPACE_DIR_NAME, "build", "index.js"))).toBe(
      true
    );
    expect(readFileSync(join(cwd, "mcp-env.d.ts"), "utf8")).toContain(
      'tools: typeof import("./src/mcp/server.js")'
    );
  });

  it("resolves an explicit entry from the project root even with --mcp-dir", async () => {
    const cwd = copyFixture("build-mcp-dir-entry");
    dirs.push(cwd);

    await runBuild({
      cwd,
      mcpDir: "does-not-need-to-exist",
      entry: "src/index.ts",
    });

    expect(existsSync(join(cwd, WORKSPACE_DIR_NAME, "build", "index.js"))).toBe(
      true
    );
  });

  it("builds standalone Next-hosted source with tsconfig aliases and server-runtime imports", async () => {
    const cwd = copyFixture("build-next-standalone");
    dirs.push(cwd);
    const packagePath = join(cwd, "package.json");
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as {
      dependencies?: Record<string, string>;
    };
    packageJson.dependencies = { ...packageJson.dependencies, next: "16.0.0" };
    writeFileSync(packagePath, JSON.stringify(packageJson));
    writeFileSync(
      join(cwd, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@/*": ["./src/*"] },
        },
      })
    );
    mkdirSync(join(cwd, "src", "services"), { recursive: true });
    writeFileSync(
      join(cwd, "src", "services", "host.ts"),
      [
        'import "server-only";',
        'import { headers } from "next/headers";',
        "export async function hostValue() {",
        "  return String((await headers()).get('x-host') ?? 'standalone');",
        "}",
      ].join("\n")
    );
    const originalEntry = readFileSync(join(cwd, "src", "index.ts"), "utf8");
    writeFileSync(
      join(cwd, "src", "index.ts"),
      `import { hostValue } from "@/services/host";\nvoid hostValue;\n${originalEntry}`
    );

    await runBuild({ cwd });

    const output = readFileSync(
      join(cwd, WORKSPACE_DIR_NAME, "build", "index.js"),
      "utf8"
    );
    expect(output).toContain("standalone");
    expect(output).not.toContain('from "server-only"');
    expect(output).not.toContain('from "next/headers"');
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
  it("configures a single React runtime and CSP-safe view evaluation", async () => {
    const plugin = mcpUseViewsPlugin({
      getViews: () => [
        {
          name: "demo",
          entryPath: "/abs/views/demo/view.tsx",
        },
      ],
    });

    const config = plugin.config;
    expect(config).toBeTypeOf("function");
    const resolvedConfig = await (
      config as () => Promise<Record<string, unknown>> | Record<string, unknown>
    )();
    expect(resolvedConfig).toMatchObject({
      resolve: { dedupe: ["react", "react-dom"] },
      optimizeDeps: {
        exclude: ["mcp-use/react"],
        include: ["react", "react-dom", "react-dom/client"],
      },
    });

    const resolveId = plugin.resolveId;
    expect(resolveId).toBeTypeOf("function");
    const cspRuntimeId = (resolveId as (id: string) => string | undefined)(
      "virtual:mcp-use/csp-runtime"
    );
    expect(cspRuntimeId).toBe("\0virtual:mcp-use/csp-runtime");

    const load = plugin.load;
    expect(load).toBeTypeOf("function");
    const cspRuntime = (load as (id: string) => string | undefined)(
      cspRuntimeId!
    );
    expect(cspRuntime).toContain("__zod_globalConfig.jitless = true");

    const source = (load as (id: string) => string | undefined)(
      `${VIRTUAL_VIEW_RESOLVED_PREFIX}demo`
    );
    expect(source?.split("\n")[0]).toBe(
      'import "virtual:mcp-use/csp-runtime";'
    );
    expect(source).toContain(
      'import * as viewModule from "/abs/views/demo/view.tsx"'
    );
    expect(source).toContain("bootstrapView(viewModule)");
    expect(source).not.toMatch(/bootstrapView\(\s*viewModule\.default\s*\)/);
  });

  it("resolves host tsconfig aliases in standalone view builds", async () => {
    const cwd = copyFixture("build-view-alias", "views");
    dirs.push(cwd);
    writeFileSync(
      join(cwd, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@/*": ["./src/*"] },
          jsx: "react-jsx",
        },
      })
    );
    mkdirSync(join(cwd, "src", "components"), { recursive: true });
    writeFileSync(
      join(cwd, "src", "components", "Shared.tsx"),
      "export function Shared() { return <span>shared-alias-marker</span>; }"
    );
    const viewPath = join(cwd, "views", "product-search-result", "view.tsx");
    const view = readFileSync(viewPath, "utf8");
    writeFileSync(
      viewPath,
      `import { Shared } from "@/components/Shared";\n${view.replace(
        '<div className="grid gap-2" data-testid="results">',
        '<div className="grid gap-2" data-testid="results"><Shared />'
      )}`
    );

    vi.spyOn(console, "warn").mockImplementation(() => {});
    await runBuild({ cwd });

    const asset = listViewAssets(
      join(cwd, WORKSPACE_DIR_NAME, "build"),
      "product-search-result"
    );
    expect(
      readFileSync(
        join(
          cwd,
          WORKSPACE_DIR_NAME,
          "build",
          "views",
          "product-search-result",
          asset.entry
        ),
        "utf8"
      )
    ).toContain("shared-alias-marker");
    vi.restoreAllMocks();
  });

  it("builds external view assets by default", async () => {
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
    expect(manifest.views["product-search-result"]).toEqual(
      expect.objectContaining({ kind: "external" })
    );
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
    expect(readFileSync(publicFile, "utf8")).toBe(
      readFileSync(join(cwd, "public", "test.txt"), "utf8")
    );
    expect(existsSync(join(buildDir, "test.txt"))).toBe(false);
    expect(
      existsSync(join(buildDir, "views", "product-search-result", "test.txt"))
    ).toBe(false);

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
        default: { fetch(request: Request): Promise<Response> };
      };
      const handler = mod.default.fetch;

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

      if (product.js.length > 1) {
        const entryJs = readFileSync(assetPath, "utf8");
        const chunkImport = entryJs.match(/from\s*"\.\/([^"]+\.js)"/);
        expect(chunkImport).not.toBeNull();
        const chunkRelative = `assets/${chunkImport![1]!}`;
        expect(product.js).toContain(chunkRelative);
        const chunkUrl = `/mcp/_mcp-use/views/product-search-result/${chunkRelative}`;
        if (!text.includes(chunkUrl)) {
          const chunkBasename = chunkImport![1]!;
          const chunkResponse = await handler(
            new Request(
              `http://localhost/mcp/_mcp-use/views/product-search-result/assets/${chunkBasename}`
            )
          );
          expect(chunkResponse.status).toBe(200);
          expect(chunkResponse.headers.get("content-type")).toContain(
            "javascript"
          );
        }
      }

      const publicOk = await handler(
        new Request("http://localhost/mcp/_mcp-use/public/test.txt")
      );
      expect(publicOk.status).toBe(200);
      expect(publicOk.headers.get("cache-control")).toBe(
        "public, max-age=0, must-revalidate"
      );
      expect(await publicOk.text()).toBe(
        readFileSync(join(cwd, "public", "test.txt"), "utf8")
      );

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

  it("embeds view JavaScript and CSS in resources with --inline", async () => {
    const cwd = copyFixture("build-views-inline", "views");
    dirs.push(cwd);

    vi.spyOn(console, "warn").mockImplementation(() => {});
    await runBuild({ cwd, inline: true });

    const buildDir = join(cwd, WORKSPACE_DIR_NAME, "build");
    const manifest = JSON.parse(
      readFileSync(join(buildDir, BUILD_MANIFEST_NAME), "utf8")
    ) as BuildManifest;
    const product = manifest.views["product-search-result"];
    expect(product).toMatchObject({ kind: "inline" });
    expect(product?.kind).toBe("inline");
    if (product?.kind !== "inline") {
      throw new Error("expected an inline view manifest entry");
    }
    expect(product.js).toMatch(/bootstrapView|createElement|react/i);
    expect(product.js).not.toContain("eu.i.posthog.com");
    expect(product.js).not.toContain(
      "phc_lyTtbYwvkdSbrcMQNPiKiiRWrrM1seyKIMjycSvItEI"
    );
    expect(product.js).not.toContain("sourceMappingURL=data:");
    expect(product.css).toContain("tailwindcss");
    expect(existsSync(join(buildDir, "views", "product-search-result"))).toBe(
      false
    );

    const entryCode = readFileSync(join(buildDir, "index.js"), "utf8");
    expect(entryCode).toMatch(/"kind"\s*:\s*"inline"/);

    const mod = (await import(
      pathToFileURL(join(buildDir, "index.js")).href
    )) as {
      default: { fetch(request: Request): Promise<Response> };
    };
    const readBody = await handlerMcp(mod.default.fetch, "resources/read", {
      uri: "ui://views/product-search-result.html",
    });
    const text = (readBody["result"] as { contents: { text: string }[] })
      .contents[0]!.text;
    expect(text).toContain('<script type="module">');
    expect(text).not.toContain('<script type="module" src=');
    expect(text).toContain("<style>");
    expect(text).not.toContain("/_mcp-use/views/product-search-result/");
  }, 60_000);

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

  it("emits source maps only when requested", async () => {
    const cwd = copyFixture("build-source-maps");
    dirs.push(cwd);

    await runBuild({ cwd, sourceMaps: true });

    expect(
      existsSync(join(cwd, WORKSPACE_DIR_NAME, "build", "index.js.map"))
    ).toBe(true);
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

  it("ignores resources/<name>/widget.tsx entries", async () => {
    const cwd = copyFixture("build-native-ignores-legacy");
    dirs.push(cwd);
    mkdirSync(join(cwd, "resources", "unused"), { recursive: true });
    writeFileSync(
      join(cwd, "resources", "unused", "widget.tsx"),
      [
        "const href = window.location.href;",
        "export const widgetMetadata = { description: href };",
        "export default function Unused() { return null; }",
      ].join("\n")
    );

    await runBuild({ cwd });

    const manifest = JSON.parse(
      readFileSync(
        join(cwd, WORKSPACE_DIR_NAME, "build", BUILD_MANIFEST_NAME),
        "utf8"
      )
    ) as BuildManifest;
    expect(manifest.views).toEqual({});
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
