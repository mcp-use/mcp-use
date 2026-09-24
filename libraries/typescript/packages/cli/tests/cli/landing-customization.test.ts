/** Real CLI dev/build coverage for an optional project landing.tsx. */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runBuild, runDev } from "../../src/cli/index.js";
import { runStart } from "../../src/bin/start.js";
import {
  copyFixture,
  getFreePort,
  mcpRequest,
  removeDir,
  waitFor,
} from "./helpers.js";

vi.mock("@mcp-use/tunnel", () => ({
  createTunnelManager: () => ({
    start: async () => ({
      url: "https://fake.local.mcp-use.run",
      subdomain: "fake",
    }),
    stop: async () => {},
    status: () => ({ url: null }),
  }),
}));

const landingSource = `import { useState } from "react";
import type { LandingPageProps } from "mcp-use/landing";
import "./landing.css";

export default function Landing({ url, name, title, version, description, tools, prompts, resources }: LandingPageProps) {
  const [clicks, setClicks] = useState(0);
  return <main data-testid="custom-landing" className="custom-landing">
    <h1>{title ?? name}</h1>
    <p data-testid="endpoint">{url}</p>
    <p data-testid="identity">{name} {version} {description}</p>
    <p data-testid="tools">{tools.map((tool) => tool.name).join(",")}</p>
    <p data-testid="prompts">{prompts.map((prompt) => prompt.name).join(",")}</p>
    <p data-testid="resources">{resources.map((resource) => resource.uri).join(",")}</p>
    <button onClick={() => setClicks((count) => count + 1)}>Clicks: {clicks}</button>
  </main>;
}
`;

const cssSource = `.custom-landing { color: rgb(11, 22, 33); }\n`;
const require = createRequire(import.meta.url);

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
  vi.restoreAllMocks();
});

function writeLanding(cwd: string, mcpRoot = cwd): void {
  mkdirSync(mcpRoot, { recursive: true });
  for (const dependency of ["react", "react-dom"]) {
    const target = join(cwd, "node_modules", dependency);
    if (!existsSync(target)) {
      symlinkSync(dirname(require.resolve(dependency)), target, "junction");
    }
  }
  writeFileSync(join(mcpRoot, "landing.tsx"), landingSource);
  writeFileSync(join(mcpRoot, "landing.css"), cssSource);
}

function writeRichServer(
  cwd: string,
  entry = join(cwd, "src", "index.ts")
): void {
  const basic = readFileSync(join(cwd, "src", "index.ts"), "utf8");
  const source = basic
    .replace(
      'name: "fixture-basic", version: "1.0.0"',
      'name: "fixture-basic", title: "Fixture Custom", version: "1.0.0", description: "A custom landing fixture."'
    )
    .replace(
      "export default server;",
      `server.prompt({ name: "plan", description: "Plan something" }, async () => ({ messages: [] }));
server.resource({ name: "docs", uri: "docs://fixture", description: "Fixture docs" }, async (uri) => ({
  contents: [{ uri: uri.href, text: "documentation" }],
}));
export default server;`
    );
  mkdirSync(dirname(entry), { recursive: true });
  writeFileSync(entry, source);
}

function htmlRequest(
  url: string,
  method: "GET" | "HEAD" = "GET"
): Promise<Response> {
  return fetch(url, { method, headers: { accept: "text/html" } });
}

async function startDev(cwd: string, mcpDir?: string): Promise<string> {
  const lines: string[] = [];
  const log = vi
    .spyOn(console, "log")
    .mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
  const controller = new AbortController();
  const done = runDev({
    cwd,
    port: await getFreePort(),
    ...(mcpDir !== undefined && { mcpDir }),
    inspector: false,
    open: false,
    signal: controller.signal,
  });
  let startupError: unknown;
  done.catch((error: unknown) => (startupError = error));
  try {
    const ready = await waitFor(async () => {
      if (startupError !== undefined) throw startupError;
      return lines.find((line) => line.includes("MCP endpoint"));
    });
    const url = /(https?:\/\/\S+)/.exec(ready)?.[1];
    if (url === undefined) throw new Error(`no URL in: ${ready}`);
    cleanups.push(async () => {
      controller.abort();
      await done;
      log.mockRestore();
    });
    return url;
  } catch (error) {
    controller.abort();
    await done.catch(() => {});
    log.mockRestore();
    throw error;
  }
}

describe("CLI landing.tsx", () => {
  it("switches between the default and custom HTML on live file creation and removal", async () => {
    const cwd = copyFixture("landing-live-discovery");
    cleanups.push(() => removeDir(cwd));
    writeRichServer(cwd);
    const url = await startDev(cwd);

    const fallback = await htmlRequest(url);
    expect(fallback.status).toBe(200);
    const fallbackHtml = await fallback.text();
    expect(fallbackHtml).toContain("Claude Code");
    expect(fallbackHtml).toContain('src="/@vite/client"');
    const viteClient = await fetch(new URL("/@vite/client", url));
    expect(viteClient.status).toBe(200);
    const viteClientSource = await viteClient.text();
    for (const [, importedPath] of viteClientSource.matchAll(
      /^import "([^"]+)";/gm
    )) {
      expect((await fetch(new URL(importedPath!, url))).status).toBe(200);
    }

    writeLanding(cwd);
    const customHtml = await waitFor(async () => {
      const response = await htmlRequest(url);
      const html = await response.text();
      return html.includes('data-testid="custom-landing"') ? html : undefined;
    });
    expect(customHtml).toContain('id="mcp-use-landing-root"');
    expect(customHtml).toContain('id="mcp-use-landing-props"');
    expect(customHtml).toContain("Fixture Custom");
    expect(customHtml).toContain("A custom landing fixture.");
    expect(customHtml).toContain("docs://fixture");
    expect(customHtml).toContain("plan");
    expect(customHtml).toContain(url);

    const get = await htmlRequest(url);
    expect(get.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(get.headers.get("cache-control")).toBe("no-store");
    expect(get.headers.get("x-content-type-options")).toBe("nosniff");
    const head = await htmlRequest(url, "HEAD");
    expect(head.status).toBe(200);
    expect(head.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await head.text()).toBe("");

    expect((await mcpRequest(url, "tools/list"))["result"]).toMatchObject({
      tools: [expect.objectContaining({ name: "add" })],
    });
    const protocolGet = await fetch(url, {
      headers: { accept: "application/json, text/event-stream" },
    });
    expect(protocolGet.status).toBe(204);

    rmSync(join(cwd, "landing.tsx"));
    await waitFor(async () => {
      const html = await (await htmlRequest(url)).text();
      return html.includes("Claude Code") && !html.includes("custom-landing")
        ? true
        : undefined;
    });
  }, 60_000);

  it("finds landing.tsx under --mcp-dir in dev", async () => {
    const cwd = copyFixture("landing-mcp-dir-dev");
    cleanups.push(() => removeDir(cwd));
    const mcpRoot = join(cwd, "src", "mcp");
    writeRichServer(cwd, join(mcpRoot, "server.ts"));
    rmSync(join(cwd, "src", "index.ts"));
    writeLanding(cwd, mcpRoot);

    const url = await startDev(cwd, "src/mcp");
    const response = await htmlRequest(url);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('data-testid="custom-landing"');
  }, 60_000);

  it("builds, starts, and serves the custom page, CSS, and public assets", async () => {
    const cwd = copyFixture("landing-build-start");
    cleanups.push(() => removeDir(cwd));
    const previousAssetsUrl = process.env["MCP_ASSETS_URL"];
    delete process.env["MCP_ASSETS_URL"];
    cleanups.push(() => {
      if (previousAssetsUrl === undefined) {
        delete process.env["MCP_ASSETS_URL"];
      } else {
        process.env["MCP_ASSETS_URL"] = previousAssetsUrl;
      }
    });
    writeRichServer(cwd);
    writeLanding(cwd);
    mkdirSync(join(cwd, "public"), { recursive: true });
    writeFileSync(join(cwd, "public", "landing-test.txt"), "public asset\n");

    await runBuild({ cwd });
    const started = await runStart({
      cwd,
      port: await getFreePort(),
      host: "127.0.0.1",
    });
    cleanups.push(() => started.close());

    const response = await htmlRequest(started.url);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('data-testid="custom-landing"');
    expect(html).toContain('id="mcp-use-landing-props"');
    const script =
      /<script[^>]+type="module"[^>]+src="([^"]+)"/.exec(html)?.[1] ??
      /<script[^>]+src="([^"]+)"[^>]+type="module"/.exec(html)?.[1];
    expect(script).toBeDefined();
    const scriptResponse = await fetch(new URL(script!, started.url));
    expect(scriptResponse.status).toBe(200);
    expect(scriptResponse.headers.get("content-type")).toMatch(/javascript/);

    const css = /<link[^>]+href="([^"]+\.css)"/.exec(html)?.[1];
    expect(css).toBeDefined();
    const cssResponse = await fetch(new URL(css!, started.url));
    expect(cssResponse.status).toBe(200);
    expect(await cssResponse.text()).toMatch(/#0b1621|rgb\(11,\s*22,\s*33\)/);

    process.env["MCP_ASSETS_URL"] = "https://cdn.example.test/landing-bucket";
    const cdnHtml = await (await htmlRequest(started.url)).text();
    expect(cdnHtml).toContain(
      `https://cdn.example.test/landing-bucket${new URL(script!).pathname}`
    );
    expect(cdnHtml).toContain(
      `https://cdn.example.test/landing-bucket${new URL(css!).pathname}`
    );
    delete process.env["MCP_ASSETS_URL"];

    const publicUrl = new URL(started.url);
    publicUrl.pathname += "/_mcp-use/public/landing-test.txt";
    const publicResponse = await fetch(publicUrl);
    expect(publicResponse.status).toBe(200);
    expect(await publicResponse.text()).toBe("public asset\n");
    expect(
      (await mcpRequest(started.url, "tools/list"))["result"]
    ).toMatchObject({
      tools: [expect.objectContaining({ name: "add" })],
    });
  }, 90_000);

  it("builds a custom landing under --mcp-dir and resolves distinct MCP URLs", async () => {
    const cwd = copyFixture("landing-mcp-dir-build");
    cleanups.push(() => removeDir(cwd));
    const mcpRoot = join(cwd, "src", "mcp");
    writeRichServer(cwd, join(mcpRoot, "server.ts"));
    rmSync(join(cwd, "src", "index.ts"));
    writeLanding(cwd, mcpRoot);

    await runBuild({ cwd, mcpDir: "src/mcp" });
    const entry = join(cwd, ".mcp-use", "build", "index.js");
    const module = (await import(pathToFileURL(entry).href)) as {
      default: { fetch(request: Request): Promise<Response> };
    };
    const first = await module.default.fetch(
      new Request("http://localhost:4111/mcp", {
        headers: { accept: "text/html" },
      })
    );
    const second = await module.default.fetch(
      new Request("http://localhost:4222/mcp", {
        headers: { accept: "text/html" },
      })
    );
    expect(await first.text()).toContain("http://localhost:4111/mcp");
    expect(await second.text()).toContain("http://localhost:4222/mcp");
  }, 90_000);

  it("keeps MCP views available when a custom landing is built alongside them", async () => {
    const cwd = copyFixture("landing-with-views", "views");
    cleanups.push(() => removeDir(cwd));
    writeLanding(cwd);

    await runBuild({ cwd });
    const started = await runStart({
      cwd,
      port: await getFreePort(),
      host: "127.0.0.1",
    });
    cleanups.push(() => started.close());

    expect(await (await htmlRequest(started.url)).text()).toContain(
      'data-testid="custom-landing"'
    );
    const resources = await mcpRequest(
      started.url,
      "resources/list",
      {},
      { ui: true }
    );
    expect(resources["result"]).toMatchObject({
      resources: expect.arrayContaining([
        expect.objectContaining({
          uri: "ui://views/product-search-result.html",
        }),
      ]),
    });
  }, 90_000);
});
