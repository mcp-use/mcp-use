/** Real CLI dev/build coverage for an optional project landing.tsx. */
import {
  existsSync,
  mkdirSync,
  readdirSync,
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
import {
  usePromptList,
  useResourceList,
  useServerInfo,
  useToolList,
} from "mcp-use/landing";
import "./landing.css";

export default function Landing() {
  const { url, name, title, version, description } = useServerInfo();
  const tools = useToolList();
  const prompts = usePromptList();
  const resources = useResourceList();
  const [clicks, setClicks] = useState(0);
  return <main data-testid="custom-landing" className="custom-landing bg-[#0d1e2f]">
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
  const errors: unknown[] = [];
  try {
    while (cleanups.length > 0) {
      try {
        await cleanups.pop()?.();
      } catch (error) {
        errors.push(error);
      }
    }
  } finally {
    vi.restoreAllMocks();
  }
  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, "test cleanup failed");
  }
});

/** Set MCP_ASSETS_URL for one test and restore it during cleanup. */
function useBuildAssetsUrl(value: string | undefined): void {
  const previous = process.env["MCP_ASSETS_URL"];
  if (value === undefined) delete process.env["MCP_ASSETS_URL"];
  else process.env["MCP_ASSETS_URL"] = value;
  cleanups.push(() => {
    if (previous === undefined) delete process.env["MCP_ASSETS_URL"];
    else process.env["MCP_ASSETS_URL"] = previous;
  });
}

/** Import a built entry and render its landing page without MCP_ASSETS_URL. */
async function fetchBuiltLanding(cwd: string, path = "/mcp"): Promise<string> {
  const entry = join(cwd, ".mcp-use", "build", "index.js");
  const module = (await import(pathToFileURL(entry).href)) as {
    default: { fetch(request: Request): Promise<Response> };
  };
  const previous = process.env["MCP_ASSETS_URL"];
  delete process.env["MCP_ASSETS_URL"];
  try {
    const response = await module.default.fetch(
      new Request(`http://localhost:4333${path}`, {
        headers: { accept: "text/html" },
      })
    );
    expect(response.status).toBe(200);
    return await response.text();
  } finally {
    if (previous !== undefined) process.env["MCP_ASSETS_URL"] = previous;
  }
}

function landingAssetUrls(html: string): {
  script: string | undefined;
  css: string | undefined;
} {
  return {
    script: /<script type="module" src="([^"]+)"/.exec(html)?.[1],
    css: /<link rel="stylesheet" href="([^"]+)"/.exec(html)?.[1],
  };
}

/** Text of the element with `data-testid`, without React's text separators. */
function testIdText(html: string, testId: string): string | undefined {
  return new RegExp(`data-testid="${testId}">(.*?)</`)
    .exec(html)?.[1]
    ?.replaceAll("<!-- -->", "");
}

/** Sorted top-level keys of the page's serialized landing data. */
function landingDataKeys(html: string): string[] {
  const json =
    /<script id="mcp-use-landing-data" type="application\/json">(.*?)<\/script>/s.exec(
      html
    )?.[1];
  expect(json).toBeDefined();
  return Object.keys(JSON.parse(json!) as object).sort();
}

/**
 * A page that reads only server info itself and renders a prompt list child
 * after hydration, so no hook of the child runs during the server render.
 */
const keyedLandingSource = (extra = ""): string =>
  `import { useEffect, useState } from "react";
import { useServerInfo } from "mcp-use/landing";
import { Prompts } from "./landing-prompts";
${extra}
export default function Landing() {
  const { name } = useServerInfo();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return <main data-testid="keyed-landing">
    <h1>{name}</h1>
    {hydrated && <Prompts />}
  </main>;
}
`;

/** Write {@link keyedLandingSource} and its conditionally rendered child. */
function writeKeyedLanding(cwd: string): void {
  writeLanding(cwd);
  writeFileSync(join(cwd, "landing.tsx"), keyedLandingSource());
  writeFileSync(
    join(cwd, "landing-prompts.tsx"),
    `import { usePromptList } from "mcp-use/landing";
export function Prompts() {
  return <p data-testid="prompts">{usePromptList().map((prompt) => prompt.name).join(",")}</p>;
}
`
  );
}

/** A landing page with an optional `metadata` export. */
function metadataLandingSource(
  metadata: Record<string, string> | undefined
): string {
  return `import { useServerInfo } from "mcp-use/landing";
${metadata === undefined ? "" : `export const metadata = ${JSON.stringify(metadata)};`}
export default function Landing() {
  return <main data-testid="metadata-landing">{useServerInfo().name}</main>;
}
`;
}

/**
 * Rewrite a file the running dev server watches. Chokidar drops a `change`
 * for a path within 50ms of the previous one, and Linux and Windows report
 * an edit fast enough for a test's next write to land inside that window.
 */
async function editWatchedFile(path: string, source: string): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 100));
  writeFileSync(path, source);
}

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

async function startDev(
  cwd: string,
  mcpDir?: string,
  lines: string[] = []
): Promise<string> {
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
    expect(customHtml).toContain('id="mcp-use-landing-data"');
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

  it("feeds hooks in dev through the module instance landing.tsx imports", async () => {
    const cwd = copyFixture("landing-dev-hooks");
    cleanups.push(() => removeDir(cwd));
    writeRichServer(cwd);
    writeLanding(cwd);
    writeFileSync(
      join(cwd, "landing-tools.tsx"),
      `import { useToolList } from "mcp-use/landing";
export function Tools() {
  return <p data-testid="nested-tools">{useToolList().map((tool) => tool.name).join(",")}</p>;
}
`
    );
    const landingWithHeading = (heading: string): string =>
      `import { useServerInfo } from "mcp-use/landing";
import { Tools } from "./landing-tools";
export default function Landing() {
  const { name, url } = useServerInfo();
  return <main data-testid="hooks-landing">
    <h1 data-testid="heading">${heading} {name}</h1>
    <p data-testid="endpoint">{url}</p>
    <Tools />
  </main>;
}
`;
    writeFileSync(join(cwd, "landing.tsx"), landingWithHeading("First"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const url = await startDev(cwd);

    const first = await (await htmlRequest(url)).text();
    expect(testIdText(first, "heading")).toBe("First fixture-basic");
    expect(testIdText(first, "endpoint")).toBe(url);
    expect(testIdText(first, "nested-tools")).toBe("add");

    // An edit clears the runner's modules: the setter must come from the
    // re-evaluated mcp-use/landing that the new landing.tsx hooks read.
    await editWatchedFile(
      join(cwd, "landing.tsx"),
      landingWithHeading("Second")
    );
    const second = await waitFor(async () => {
      const html = await (await htmlRequest(url)).text();
      return testIdText(html, "heading") === "Second fixture-basic"
        ? html
        : undefined;
    });
    expect(testIdText(second, "nested-tools")).toBe("add");

    // A broken edit keeps serving the last working component with its data.
    await editWatchedFile(
      join(cwd, "landing.tsx"),
      "export default 'not a component';\n"
    );
    const fallbackHtml = await waitFor(async () => {
      const response = await htmlRequest(url);
      const html = await response.text();
      return errors.mock.calls.some(
        ([message]) =>
          message ===
          "[mcp-use] landing update failed; serving last working page"
      ) && response.status === 200
        ? html
        : undefined;
    });
    expect(testIdText(fallbackHtml, "heading")).toBe("Second fixture-basic");
    expect(testIdText(fallbackHtml, "nested-tools")).toBe("add");
  }, 60_000);

  it("ships in dev only the lists the current landing import graph reads", async () => {
    const cwd = copyFixture("landing-dev-data-keys");
    cleanups.push(() => removeDir(cwd));
    writeRichServer(cwd);
    writeKeyedLanding(cwd);
    const url = await startDev(cwd);

    // The child that reads prompts renders only after hydration, so the key
    // comes from its import, not from a hook call during the server render.
    const first = await (await htmlRequest(url)).text();
    expect(first).toContain('data-testid="keyed-landing"');
    expect(first).not.toContain('data-testid="prompts"');
    expect(landingDataKeys(first)).toEqual(["prompts", "server"]);

    await editWatchedFile(
      join(cwd, "landing.tsx"),
      keyedLandingSource(`import { useToolList } from "mcp-use/landing";
export function ToolCount() {
  return <p>{useToolList().length}</p>;
}`)
    );
    await waitFor(async () => {
      const html = await (await htmlRequest(url)).text();
      return landingDataKeys(html).includes("tools") ? true : undefined;
    });
    expect(landingDataKeys(await (await htmlRequest(url)).text())).toEqual([
      "prompts",
      "server",
      "tools",
    ]);

    // Dropping the child's import stops shipping its list, although the
    // child module itself is unchanged and its transform stays cached.
    await editWatchedFile(
      join(cwd, "landing.tsx"),
      `import { useServerInfo } from "mcp-use/landing";
export default function Landing() {
  return <main data-testid="keyed-landing">{useServerInfo().name}</main>;
}
`
    );
    await waitFor(async () => {
      const html = await (await htmlRequest(url)).text();
      return landingDataKeys(html).join() === "server" ? true : undefined;
    });
  }, 60_000);

  it("reloads an open dev page instead of hot-updating in a hook its data lacks", async () => {
    const cwd = copyFixture("landing-dev-data-keys-reload");
    cleanups.push(() => removeDir(cwd));
    writeRichServer(cwd);
    writeKeyedLanding(cwd);
    const url = await startDev(cwd);
    const { origin, port } = new URL(url);
    expect(landingDataKeys(await (await htmlRequest(url)).text())).toEqual([
      "prompts",
      "server",
    ]);
    // Load the client graph the way the open page does; Fast Refresh then
    // accepts edits to the child.
    for (const path of [
      "/@id/__x00__virtual:mcp-use/landing",
      "/landing.tsx",
    ]) {
      expect((await fetch(`${origin}${path}`)).status).toBe(200);
    }
    const child = await fetch(`${origin}/landing-prompts.tsx`);
    expect(await child.text()).toContain("RefreshRuntime");

    const messages: { type: string }[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`, "vite-hmr");
    ws.addEventListener("message", (event) => {
      messages.push(JSON.parse(String(event.data)) as { type: string });
    });
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", () =>
        reject(new Error("HMR websocket failed to connect"))
      );
    });
    cleanups.push(() => ws.close());

    // An edit that needs no new list stays a hot update.
    await editWatchedFile(
      join(cwd, "landing-prompts.tsx"),
      `import { usePromptList } from "mcp-use/landing";
export function Prompts() {
  return <p data-testid="prompts">{usePromptList().length}</p>;
}
`
    );
    await waitFor(async () =>
      messages.some((message) => message.type === "update") ? true : undefined
    );
    expect(messages.filter((m) => m.type === "full-reload")).toEqual([]);

    // A newly imported hook reloads the page, whose HTML ships its list.
    await editWatchedFile(
      join(cwd, "landing-prompts.tsx"),
      `import { usePromptList, useToolList } from "mcp-use/landing";
export function Prompts() {
  return <p data-testid="prompts">{usePromptList().length}{useToolList().length}</p>;
}
`
    );
    await waitFor(async () =>
      messages.some((message) => message.type === "full-reload")
        ? true
        : undefined
    );
    expect(landingDataKeys(await (await htmlRequest(url)).text())).toEqual([
      "prompts",
      "server",
      "tools",
    ]);
  }, 60_000);

  it("ships in dev the list a lazily imported child reads", async () => {
    const cwd = copyFixture("landing-dev-lazy-data-keys");
    cleanups.push(() => removeDir(cwd));
    writeRichServer(cwd);
    writeLanding(cwd);
    writeFileSync(
      join(cwd, "landing.tsx"),
      `import { lazy, Suspense, useEffect, useState } from "react";
import { useServerInfo } from "mcp-use/landing";
const Resources = lazy(() => import("./landing-resources"));
export default function Landing() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return <main data-testid="lazy-landing">
    {useServerInfo().name}
    {hydrated && <Suspense><Resources /></Suspense>}
  </main>;
}
`
    );
    writeFileSync(
      join(cwd, "landing-resources.tsx"),
      `import { useResourceList } from "mcp-use/landing";
export default function Resources() {
  return <p>{useResourceList().length}</p>;
}
`
    );
    const url = await startDev(cwd);

    // The server render never runs the dynamic import, so the child is
    // transformed for its imports before the keys are resolved.
    const html = await (await htmlRequest(url)).text();
    expect(html).toContain('data-testid="lazy-landing"');
    expect(landingDataKeys(html)).toEqual(["resources", "server"]);
  }, 60_000);

  it("keeps the project Vite config off tool-only dev servers until restart", async () => {
    const cwd = copyFixture("landing-tool-only-vite-config");
    cleanups.push(() => removeDir(cwd));
    const marker = "__mcpUseLandingViteConfigLoads";
    const globals = globalThis as Record<string, unknown>;
    delete globals[marker];
    cleanups.push(() => {
      delete globals[marker];
    });
    writeFileSync(
      join(cwd, "vite.config.mts"),
      `globalThis.${marker} = (globalThis.${marker} ?? 0) + 1;\nexport default {};\n`
    );
    const lines: string[] = [];
    const url = await startDev(cwd, undefined, lines);
    expect(globals[marker]).toBeUndefined();

    writeLanding(cwd);
    await waitFor(async () => {
      const html = await (await htmlRequest(url)).text();
      return html.includes('data-testid="custom-landing"') ? true : undefined;
    });
    expect(lines).toContain(
      "[mcp-use] landing.tsx added — restart mcp-use dev to apply vite.config.mts to it"
    );
    expect(globals[marker]).toBeUndefined();
  }, 60_000);

  it("loads the project Vite config when landing.tsx exists at dev startup", async () => {
    const cwd = copyFixture("landing-startup-vite-config");
    cleanups.push(() => removeDir(cwd));
    const marker = "__mcpUseLandingStartupViteConfigLoads";
    const globals = globalThis as Record<string, unknown>;
    delete globals[marker];
    cleanups.push(() => {
      delete globals[marker];
    });
    writeFileSync(
      join(cwd, "vite.config.mts"),
      `globalThis.${marker} = (globalThis.${marker} ?? 0) + 1;\nexport default {};\n`
    );
    writeLanding(cwd);
    const url = await startDev(cwd);
    expect(globals[marker]).toBe(1);
    expect(await (await htmlRequest(url)).text()).toContain(
      'data-testid="custom-landing"'
    );
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
    const html = await response.text();
    expect(html).toContain('data-testid="custom-landing"');

    // The head links the managed Tailwind stylesheet, built from the classes
    // of the nested landing.tsx, so the server markup is styled before the
    // hydration entry runs.
    const { css } = landingAssetUrls(html);
    expect(css).toBe(
      new URL("/@id/__x00__virtual:mcp-use/tailwind.css", url).href
    );
    const cssResponse = await fetch(css!, { headers: { accept: "text/css" } });
    expect(cssResponse.status).toBe(200);
    expect(cssResponse.headers.get("content-type")).toMatch(/text\/css/);
    expect(await cssResponse.text()).toContain("#0d1e2f");
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
    expect(html).toContain('id="mcp-use-landing-data"');
    expect(testIdText(html, "endpoint")).toBe(started.url);
    expect(testIdText(html, "identity")).toBe(
      "fixture-basic 1.0.0 A custom landing fixture."
    );
    expect(testIdText(html, "tools")).toBe("add");
    expect(testIdText(html, "prompts")).toBe("plan");
    expect(testIdText(html, "resources")).toBe("docs://fixture");
    expect(html).toContain("<h1>Fixture Custom</h1>");
    const script =
      /<script[^>]+type="module"[^>]+src="([^"]+)"/.exec(html)?.[1] ??
      /<script[^>]+src="([^"]+)"[^>]+type="module"/.exec(html)?.[1];
    expect(script).toBeDefined();
    const scriptResponse = await fetch(new URL(script!, started.url));
    expect(scriptResponse.status).toBe(200);
    expect(scriptResponse.headers.get("content-type")).toMatch(/javascript/);
    expect(await scriptResponse.text()).toContain("mcp-use-landing-data");

    const css = /<link[^>]+href="([^"]+\.css)"/.exec(html)?.[1];
    expect(css).toBeDefined();
    const cssResponse = await fetch(new URL(css!, started.url));
    expect(cssResponse.status).toBe(200);
    const cssText = await cssResponse.text();
    expect(cssText).toMatch(/#0b1621|rgb\(11,\s*22,\s*33\)/);
    // The managed Tailwind stylesheet is bundled with the page's own CSS.
    expect(cssText).toContain("#0d1e2f");

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

  it("bakes MCP_ASSETS_URL into landing assets of a tool-only build", async () => {
    const cwd = copyFixture("landing-cdn-tools");
    cleanups.push(() => removeDir(cwd));
    writeRichServer(cwd);
    const indexPath = join(cwd, "src", "index.ts");
    writeFileSync(
      indexPath,
      readFileSync(indexPath, "utf8").replace(
        'description: "A custom landing fixture."',
        'description: "A custom landing fixture.", basePath: "/api/mcp"'
      )
    );
    writeLanding(cwd);
    useBuildAssetsUrl("https://cdn.example.test/bucket/");
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });

    await runBuild({ cwd });

    const { script, css } = landingAssetUrls(
      await fetchBuiltLanding(cwd, "/api/mcp")
    );
    const prefix = "https://cdn.example.test/bucket/api/mcp/_mcp-use/landing/";
    expect(script?.slice(0, prefix.length)).toBe(prefix);
    expect(script).toMatch(/\/assets\/[^/]+\.js$/);
    expect(css?.slice(0, prefix.length)).toBe(prefix);
    expect(css).toMatch(/\/assets\/[^/]+\.css$/);
    expect(
      existsSync(
        join(cwd, ".mcp-use/build/landing", script!.slice(prefix.length))
      )
    ).toBe(true);
    expect(lines).toContain(
      `[mcp-use] MCP_ASSETS_URL set — publish .mcp-use/build/landing/ at ${prefix}`
    );
  }, 90_000);

  it("bakes MCP_ASSETS_URL into landing assets built alongside views", async () => {
    const cwd = copyFixture("landing-cdn-views", "views");
    cleanups.push(() => removeDir(cwd));
    writeLanding(cwd);
    useBuildAssetsUrl("https://cdn.example.test/bucket");

    await runBuild({ cwd });

    const { script, css } = landingAssetUrls(await fetchBuiltLanding(cwd));
    const prefix = "https://cdn.example.test/bucket/mcp/_mcp-use/landing/";
    expect(script?.slice(0, prefix.length)).toBe(prefix);
    expect(script).toMatch(/\/assets\/[^/]+\.js$/);
    expect(css?.slice(0, prefix.length)).toBe(prefix);
    expect(css).toMatch(/\/assets\/[^/]+\.css$/);
    const entryCode = readFileSync(
      join(cwd, ".mcp-use/build/index.js"),
      "utf8"
    );
    expect(entryCode).toContain(
      "https://cdn.example.test/bucket/mcp/_mcp-use/views/product-search-result/assets/"
    );
  }, 90_000);

  it("keeps MCP_ASSETS_URL on landing assets when views are inlined", async () => {
    const cwd = copyFixture("landing-cdn-views-inline", "views");
    cleanups.push(() => removeDir(cwd));
    writeLanding(cwd);
    useBuildAssetsUrl("https://cdn.example.test/bucket");
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });

    await runBuild({ cwd, inline: true });

    const { script, css } = landingAssetUrls(await fetchBuiltLanding(cwd));
    const prefix = "https://cdn.example.test/bucket/mcp/_mcp-use/landing/";
    expect(script?.slice(0, prefix.length)).toBe(prefix);
    expect(css?.slice(0, prefix.length)).toBe(prefix);
    const entryCode = readFileSync(
      join(cwd, ".mcp-use/build/index.js"),
      "utf8"
    );
    expect(entryCode).toMatch(/"kind"\s*:\s*"inline"/);
    expect(entryCode).not.toContain(
      "https://cdn.example.test/bucket/mcp/_mcp-use/views/"
    );
    const publishLines = lines.filter((line) =>
      line.startsWith("[mcp-use] MCP_ASSETS_URL set")
    );
    expect(publishLines).toEqual([
      `[mcp-use] MCP_ASSETS_URL set — publish .mcp-use/build/landing/ at ${prefix}`,
    ]);
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

  it("builds a page that ships only the lists its import graph reads", async () => {
    const cwd = copyFixture("landing-build-data-keys");
    cleanups.push(() => removeDir(cwd));
    writeRichServer(cwd);
    writeKeyedLanding(cwd);

    await runBuild({ cwd });
    const started = await runStart({
      cwd,
      port: await getFreePort(),
      host: "127.0.0.1",
    });
    cleanups.push(() => started.close());

    const html = await (await htmlRequest(started.url)).text();
    expect(html).toContain('data-testid="keyed-landing"');
    expect(html).not.toContain('data-testid="prompts"');
    expect(landingDataKeys(html)).toEqual(["prompts", "server"]);
  }, 90_000);

  it("builds a page whose metadata export sets the document head", async () => {
    const cwd = copyFixture("landing-build-metadata");
    cleanups.push(() => removeDir(cwd));
    writeRichServer(cwd);
    writeLanding(cwd);
    writeFileSync(
      join(cwd, "landing.tsx"),
      metadataLandingSource({ title: "Built <Title>", image: "og.png" })
    );

    await runBuild({ cwd });
    const started = await runStart({
      cwd,
      port: await getFreePort(),
      host: "127.0.0.1",
    });
    cleanups.push(() => started.close());

    const html = await (await htmlRequest(started.url)).text();
    expect(html).toContain('data-testid="metadata-landing"');
    expect(html).toContain("<title>Built &lt;Title&gt;</title>");
    expect(html).toContain(
      '<meta name="description" content="A custom landing fixture.">'
    );
    expect(html).toContain(
      `<meta property="og:image" content="${started.url}/_mcp-use/public/og.png">`
    );
  }, 90_000);

  it("builds a page whose stylesheet imports Tailwind and extends its theme", async () => {
    const cwd = copyFixture("landing-build-tailwind");
    cleanups.push(() => removeDir(cwd));
    writeLanding(cwd);
    // The server bundle renders landing.tsx too, so it must not try to
    // resolve `@import "tailwindcss"` from a project without that dependency.
    writeFileSync(
      join(cwd, "landing.css"),
      '@import "tailwindcss";\n@theme { --color-brand: #ff3366; }\n'
    );
    writeFileSync(
      join(cwd, "landing.tsx"),
      `import "./landing.css";
export default function Landing() {
  return <main className="bg-brand">Brand</main>;
}
`
    );

    await runBuild({ cwd });

    const assets = join(cwd, ".mcp-use", "build", "landing", "assets");
    const stylesheet = readdirSync(assets).find((file) =>
      file.endsWith(".css")
    );
    expect(stylesheet).toBeDefined();
    const css = readFileSync(join(assets, stylesheet!), "utf8");
    expect(css).toMatch(/\.bg-brand\{background-color:var\(--color-brand\)\}/);
    expect(css).toMatch(/--color-brand:(#ff3366|#f36)/);
  }, 90_000);

  it("reads the metadata export of the current landing.tsx in dev", async () => {
    const cwd = copyFixture("landing-dev-metadata");
    cleanups.push(() => removeDir(cwd));
    writeRichServer(cwd);
    writeLanding(cwd);
    writeFileSync(
      join(cwd, "landing.tsx"),
      metadataLandingSource({ title: "First title" })
    );
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const url = await startDev(cwd);

    expect(await (await htmlRequest(url)).text()).toContain(
      "<title>First title</title>"
    );

    await editWatchedFile(
      join(cwd, "landing.tsx"),
      metadataLandingSource({ title: "Second title" })
    );
    await waitFor(async () => {
      const html = await (await htmlRequest(url)).text();
      return html.includes("<title>Second title</title>") ? true : undefined;
    });

    // A broken edit keeps the head of the last working page with its body.
    await editWatchedFile(
      join(cwd, "landing.tsx"),
      `export const metadata = { title: "Broken title" };
export default "not a component";
`
    );
    const fallbackHtml = await waitFor(async () => {
      const response = await htmlRequest(url);
      const html = await response.text();
      return errors.mock.calls.some(
        ([message]) =>
          message ===
          "[mcp-use] landing update failed; serving last working page"
      ) && response.status === 200
        ? html
        : undefined;
    });
    expect(fallbackHtml).toContain("<title>Second title</title>");
    expect(fallbackHtml).toContain('data-testid="metadata-landing"');

    // Without the export, the server's default title comes back.
    await editWatchedFile(
      join(cwd, "landing.tsx"),
      metadataLandingSource(undefined)
    );
    await waitFor(async () => {
      const html = await (await htmlRequest(url)).text();
      return html.includes(
        "<title>Fixture Custom MCP Server — Connect with Claude Code, Cursor &amp; VS Code</title>"
      )
        ? true
        : undefined;
    });
  }, 60_000);
});
