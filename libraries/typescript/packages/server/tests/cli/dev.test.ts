/**
 * e2e tests for runDev: a real Vite dev server + module runner serving the
 * fixture over HTTP, including edit-triggered reload and error resilience.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runDev } from "../../src/cli/index.js";
import {
  copyFixture,
  getFreePort,
  listToolNames,
  mcpRequest,
  occupyPort,
  removeDir,
  waitFor,
} from "./helpers.js";

interface DevHandle {
  url: string;
  stop: () => Promise<void>;
}

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

/** Start runDev in-process and wait for the ready log to learn the URL. */
async function startDev(cwd: string, port: number): Promise<DevHandle> {
  const lines: string[] = [];
  const logSpy = vi
    .spyOn(console, "log")
    .mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });

  const controller = new AbortController();
  const done = runDev({ cwd, port, signal: controller.signal });
  // Surface startup failures instead of hanging in waitFor.
  let startupError: unknown;
  done.catch((error: unknown) => (startupError = error));

  try {
    const endpointLine = await waitFor(async () => {
      if (startupError !== undefined) throw startupError;
      return lines.find((l) => l.includes("MCP endpoint"));
    });
    const url = /(http:\/\/\S+)/.exec(endpointLine)?.[1];
    if (url === undefined) throw new Error(`no URL in: ${endpointLine}`);
    return {
      url,
      stop: async () => {
        controller.abort();
        await done;
        logSpy.mockRestore();
      },
    };
  } catch (error) {
    logSpy.mockRestore();
    controller.abort();
    await done.catch(() => {});
    throw error;
  }
}

describe("runDev", () => {
  it("serves the MCP endpoint and reloads on file change", async () => {
    const cwd = copyFixture("dev");
    cleanups.push(() => removeDir(cwd));

    const port = await getFreePort();
    const dev = await startDev(cwd, port);
    cleanups.push(dev.stop);

    expect(dev.url).toBe(`http://localhost:${port}/mcp`);
    expect(await listToolNames(dev.url)).toEqual(["add"]);

    // --- Edit-triggered reload: add a tool, poll until tools/list shows it.
    const entry = join(cwd, "src", "index.ts");
    const source = readFileSync(entry, "utf8");
    writeFileSync(
      entry,
      source.replace(
        "export default server;",
        `server.tool(
  { name: "subtract", description: "Subtract", schema: z.object({ a: z.number(), b: z.number() }) },
  async ({ a, b }) => ({ content: [{ type: "text", text: String(a - b) }] })
);
export default server;`
      )
    );
    await waitFor(async () =>
      (await listToolNames(dev.url)).includes("subtract") ? true : undefined
    );
    expect(await listToolNames(dev.url)).toEqual(["add", "subtract"]);

    // --- A broken save keeps the previous handler alive (never crashes).
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    cleanups.push(() => errorSpy.mockRestore());
    writeFileSync(entry, "this is not valid typescript {{{\n");
    await waitFor(async () =>
      errorSpy.mock.calls.some((call) =>
        String(call[0]).includes("reload failed")
      )
        ? true
        : undefined
    );
    expect(await listToolNames(dev.url)).toEqual(["add", "subtract"]);
  });

  it("probes upward when the requested port is taken", async () => {
    const cwd = copyFixture("dev-port");
    cleanups.push(() => removeDir(cwd));

    const port = await getFreePort();
    const blocker = await occupyPort(port);
    cleanups.push(
      () => new Promise<void>((r) => blocker.close(() => r()))
    );

    const dev = await startDev(cwd, port);
    cleanups.push(dev.stop);

    const boundPort = Number(new URL(dev.url).port);
    expect(boundPort).toBeGreaterThan(port);
    expect(await listToolNames(dev.url)).toEqual(["add"]);
  });

  it("rejects an entry without a default MCPServer export", async () => {
    const cwd = copyFixture("dev-bad");
    cleanups.push(() => removeDir(cwd));
    writeFileSync(join(cwd, "src", "index.ts"), "export const nope = 1;\n");

    const port = await getFreePort();
    await expect(runDev({ cwd, port })).rejects.toThrow(
      /export default server/
    );
  });
});

describe("runDev (views)", () => {
  it("serves view documents, virtual entries, and reloads on view add", async () => {
    const cwd = copyFixture("dev-views", "views");
    cleanups.push(() => removeDir(cwd));

    const port = await getFreePort();
    const dev = await startDev(cwd, port);
    cleanups.push(dev.stop);

    const base = dev.url.replace(/\/mcp$/, "");

    const docResponse = await fetch(
      `${base}/mcp/_mcp-use/views/product-search-result.html`
    );
    expect(docResponse.status).toBe(200);
    expect(docResponse.headers.get("cache-control")).toBe("no-store");
    const docHtml = await docResponse.text();
    expect(docHtml).toContain('id="root"');
    expect(docHtml).toContain("/@vite/client");
    expect(docHtml).toMatch(/virtual:mcp-use\/views\/product-search-result/);

    const readBody = await mcpRequest(dev.url, "resources/read", {
      uri: "ui://views/product-search-result.html",
    }, { ui: true });
    const readText = (
      readBody["result"] as { contents: { text: string }[] }
    ).contents[0]!.text;
    expect(readText).toContain("/@vite/client");

    const virtualMatch = /src="([^"]+virtual:mcp-use\/views\/product-search-result[^"]*)"/.exec(
      docHtml
    );
    expect(virtualMatch).not.toBeNull();
    const virtualUrl = new URL(virtualMatch![1]!, base).href;
    const virtualResponse = await fetch(virtualUrl);
    expect(virtualResponse.status).toBe(200);
    const virtualJs = await virtualResponse.text();
    expect(virtualJs).toMatch(/bootstrapView/);

    const viewModuleResponse = await fetch(
      `${base}/resources/product-search-result/view.tsx`
    );
    expect(viewModuleResponse.status).toBe(200);

    const assetImportResponse = await fetch(
      `${base}/resources/product-search-result/badge.png?import`
    );
    expect(assetImportResponse.status).toBe(200);
    const assetImportJs = await assetImportResponse.text();
    expect(assetImportJs).toMatch(
      new RegExp(`http://127\\.0\\.0\\.1:${port}/resources/product-search-result/badge\\.png`)
    );

    const publicResponse = await fetch(
      `${base}/mcp/_mcp-use/public/test.txt`
    );
    expect(publicResponse.status).toBe(200);
    expect(publicResponse.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate"
    );
    expect(await publicResponse.text()).toBe("public-fixture\n");

    const docConfigMatch = /__mcpUseViewConfig=\{[^}]*"publicBase":"([^"]+)"/.exec(
      docHtml
    );
    expect(docConfigMatch).not.toBeNull();
    expect(docConfigMatch![1]).toBe(
      `http://localhost:${port}/mcp/_mcp-use/public/`
    );

    const toolsBody = await mcpRequest(dev.url, "tools/list", {}, { ui: true });
    const searchTool = (
      toolsBody["result"] as {
        tools: { name: string; _meta?: Record<string, unknown> }[];
      }
    ).tools.find((t) => t.name === "search-products");
    expect(searchTool?._meta?.["ui"]).toMatchObject({
      resourceUri: "ui://views/product-search-result.html",
    });

    const resourcesBody = await mcpRequest(
      dev.url,
      "resources/list",
      {},
      { ui: true }
    );
    const viewResource = (
      resourcesBody["result"] as {
        resources: {
          uri: string;
          _meta?: Record<string, unknown>;
        }[];
      }
    ).resources.find((r) => r.uri === "ui://views/product-search-result.html");
    const connectDomains = (
      viewResource?._meta?.["ui"] as
        | { csp?: { connectDomains?: string[] } }
        | undefined
    )?.csp?.connectDomains;
    expect(connectDomains).toEqual(
      expect.arrayContaining([`ws://localhost:${port}`])
    );

    mkdirSync(join(cwd, "resources", "extra-view"), { recursive: true });
    writeFileSync(
      join(cwd, "resources", "extra-view", "view.tsx"),
      `export default function Extra() { return <div>extra</div>; }\n`
    );

    await waitFor(async () => {
      const list = await mcpRequest(dev.url, "resources/list", {}, { ui: true });
      const uris = (list["result"] as { resources: { uri: string }[] }).resources.map(
        (r) => r.uri
      );
      return uris.includes("ui://views/extra-view.html") ? true : undefined;
    });
  }, 60_000);

  it("runs two dev servers concurrently with HMR on each main port", async () => {
    // Regression: the HMR websocket must ride the main HTTP listener
    // (server.hmr.server), not a fixed side port — a hardcoded HMR port made
    // the second concurrent `mcp-use dev` process fail to bind.
    const cwdA = copyFixture("dev-views-a", "views");
    const cwdB = copyFixture("dev-views-b", "views");
    cleanups.push(() => removeDir(cwdA), () => removeDir(cwdB));

    const portA = await getFreePort();
    const devA = await startDev(cwdA, portA);
    cleanups.push(devA.stop);
    const portB = await getFreePort();
    const devB = await startDev(cwdB, portB);
    cleanups.push(devB.stop);

    // Vite's HMR client speaks the `vite-hmr` subprotocol and greets with a
    // `connected` message; an upgrade succeeding on the MAIN port proves the
    // websocket shares the one listener.
    const probeHmr = async (port: number): Promise<string> =>
      new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/`, "vite-hmr");
        const timer = setTimeout(() => {
          ws.close();
          reject(new Error(`no HMR greeting on port ${port}`));
        }, 10_000);
        ws.addEventListener("message", (event) => {
          clearTimeout(timer);
          ws.close();
          resolve(String(event.data));
        });
        ws.addEventListener("error", () => {
          clearTimeout(timer);
          reject(new Error(`websocket upgrade failed on port ${port}`));
        });
      });

    expect(await probeHmr(portA)).toContain("connected");
    expect(await probeHmr(portB)).toContain("connected");

    // Both servers keep serving MCP + view documents side by side.
    for (const dev of [devA, devB]) {
      const base = dev.url.replace(/\/mcp$/, "");
      const doc = await fetch(
        `${base}/mcp/_mcp-use/views/product-search-result.html`
      );
      expect(doc.status).toBe(200);
    }
  }, 90_000);
});
