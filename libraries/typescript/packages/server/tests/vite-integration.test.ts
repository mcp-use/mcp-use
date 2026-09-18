import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import {
  createServer,
  isRunnableDevEnvironment,
  type ViteDevServer,
} from "vite";
import { mcpUse } from "../src/vite/index.js";

const requireCli = createRequire(import.meta.resolve("@mcp-use/cli"));
const { default: react } = await import(
  requireCli.resolve("@vitejs/plugin-react")
);
let vite: ViteDevServer | undefined;
let root: string | undefined;
afterEach(async () => {
  await vite?.close();
  vite = undefined;
  if (root) await rm(root, { recursive: true, force: true });
});

async function write(path: string, content: string) {
  await mkdir(join(root!, path, ".."), { recursive: true });
  await writeFile(join(root!, path), content);
}

const serverSource = `import { MCPServer } from "mcp-use";
import { value } from "./value";
const server = new MCPServer({name:"vite-test",version:"1",basePath:"/api/mcp",cors:{origin:"*"}});
server.get("/api/mcp/value", () => new Response(value));
server.get("/api/mcp/pending", c => new Promise(resolve => {
  c.req.raw.signal.addEventListener("abort", () => resolve(new Response("aborted",{status:503})),{once:true});
}));
export default server;`;

async function start(base = "/") {
  root = await mkdtemp(join(import.meta.dirname, ".vite-test-"));
  await write("server.ts", serverSource);
  await write("value.ts", 'export const value = "first";');
  vite = await createServer({
    configFile: false,
    root,
    base,
    logLevel: "warn",
    plugins: [
      mcpUse({ entry: "server.ts", viewsDir: "views", basePath: "/api/mcp" }),
      react(),
    ],
    server: { host: "127.0.0.1", port: 0 },
  });
  await vite.listen();
  const ssr = vite.environments.ssr!;
  if (!isRunnableDevEnvironment(ssr)) throw new Error("Missing SSR runner");
  const { handleMcpRequest } = await ssr.runner.import("#mcp-use-vite-handler");
  const address = vite.httpServer!.address() as { port: number };
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    request: (path: string, init?: RequestInit) =>
      handleMcpRequest(new Request(origin + path, init)) as Promise<Response>,
  };
}

async function eventually(check: () => Promise<void>) {
  const deadline = Date.now() + 10000;
  for (;;) {
    try {
      await check();
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

describe("MCP Vite environments", () => {
  it("reloads server dependencies, recovers from errors, and cancels old requests", async () => {
    const { request } = await start();
    expect(await (await request("/api/mcp/value")).text()).toBe("first");
    const pending = request("/api/mcp/pending");
    // Allow the request to enter the previous instance before replacing it.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await write("value.ts", 'export const value = "second";');
    await eventually(async () =>
      expect(await (await request("/api/mcp/value")).text()).toBe("second")
    );
    expect((await pending).status).toBe(503);
    await write("value.ts", "export const value = ;");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await (await request("/api/mcp/value")).text()).toBe("second");
    await write("value.ts", 'export const value = "recovered";');
    await eventually(async () =>
      expect(await (await request("/api/mcp/value")).text()).toBe("recovered")
    );
    // The authored entry is evaluated only in the MCP environment.
    expect(
      vite!.environments.ssr!.moduleGraph.getModuleById(
        join(root!, "server.ts")
      )
    ).toBeUndefined();
  });

  it("discovers the first view and skills without restarting and serves iframe modules with CORS", async () => {
    const { origin, request } = await start("/app/");
    const rpc = async (
      method: string,
      params: Record<string, unknown> = {}
    ) => {
      const response = await request("/api/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      return response.text();
    };
    await write(
      "views/card/view.tsx",
      "export default function Card() { return <div>Live card</div>; }"
    );
    await eventually(async () => {
      const response = await fetch(
        `${origin}/app/@id/__x00__virtual:mcp-use/views/card`,
        { headers: { origin: "null" } }
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe("null");
      expect(response.headers.get("vary")).toMatch(/origin/i);
      expect(await response.text()).toContain("preamble");
    });
    await write(
      "skills/review/SKILL.md",
      "---\nname: review\ndescription: Review code\n---\nFirst skill version"
    );
    // Skills are non-module files: creating the directory must rebuild registrations.
    await eventually(async () => {
      expect(await rpc("resources/list")).toContain("SKILL.md");
    });
    await write(
      "skills/review/SKILL.md",
      "---\nname: review\ndescription: Review code\n---\nUpdated skill version"
    );
    await eventually(async () =>
      expect(
        await rpc("resources/read", { uri: "skill://review/SKILL.md" })
      ).toContain("Updated skill version")
    );
    await rm(join(root!, "skills/review"), { recursive: true });
    await eventually(async () =>
      expect(await rpc("resources/list")).not.toContain("SKILL.md")
    );

    // Source edits to a browser-only view must not replace the MCP server.
    const controller = new AbortController();
    const pending = request("/api/mcp/pending", {
      signal: controller.signal,
    }).catch(() => undefined);
    await write(
      "views/card/view.tsx",
      "export default function Card() { return <div>Updated card</div>; }"
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(settled).toBe(false);
    controller.abort();
    await pending;

    await expect(
      vite!.environments.client!.transformRequest("#mcp-use-vite-handler")
    ).rejects.toThrow("server route");
  });
});
