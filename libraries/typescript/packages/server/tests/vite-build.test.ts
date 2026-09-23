import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBuilder, type InlineConfig } from "vite";
import { mcpUse } from "../src/vite/index.js";

const execute = promisify(execFile);
let root: string;
afterEach(async () => {
  vi.unstubAllEnvs();
  if (root) await rm(root, { recursive: true, force: true });
});

async function write(path: string, content: string) {
  await mkdir(join(root, path, ".."), { recursive: true });
  await writeFile(join(root, path), content);
}

async function fixture(source: string) {
  root = await mkdtemp(join(import.meta.dirname, ".vite-build-"));
  await write("package.json", '{"type":"module"}');
  await mkdir(join(root, "node_modules"));
  await symlink(
    join(import.meta.dirname, ".."),
    join(root, "node_modules/mcp-use")
  );
  await write("src/server.ts", source);
}

async function build(config: InlineConfig = {}) {
  const builder = await createBuilder({
    configFile: false,
    root,
    logLevel: "silent",
    define: { __CLOSE_MARKER__: JSON.stringify(join(root, "closed.txt")) },
    ...config,
    plugins: [
      mcpUse({ entry: "src/server.ts", viewsDir: "src/views" }),
      ...(config.plugins ?? []),
    ],
  });
  await builder.buildApp();
}

describe("MCP production validation", () => {
  it.each(["production", "staging"])(
    "uses host build configuration in %s and deploys without source files",
    async (mode) => {
      vi.stubEnv("NODE_ENV", "production");
      await fixture(`import { MCPServer } from "mcp-use";
import { z } from "zod";
import { writeFile } from "node:fs/promises";
import virtualValue from "virtual:host-config";
import aliasValue from "@host/value";
const values = { name: __APP_NAME__, virtualValue, aliasValue,
  mode: import.meta.env.MODE, production: import.meta.env.PROD,
  envValue: import.meta.env.APP_VALUE };
if (values.name !== "configured-name" || virtualValue !== "build-only" ||
    aliasValue !== "aliased" || !values.production ||
    values.envValue !== values.mode) throw new Error("Host config lost");
const server = new MCPServer({name: values.name, version:"1"});
server.get("/mcp/config", () => Response.json(values));
server.tool({name:"card", outputSchema:z.object({}), view:{name:"card"}},
  async () => ({content:[], structuredContent:{}}));
const close = server.close.bind(server);
server.close = async () => { await close(); await writeFile(__CLOSE_MARKER__, "closed"); };
export default server;`);
      await write(`env/.env.${mode}`, `APP_VALUE=${mode}\n`);
      await write("src/value.ts", 'export default "aliased";');
      await write(
        "src/route.ts",
        'import { createTanStackStartHandler } from "mcp-use/tanstack-start"; export const handleMcpRequest = createTanStackStartHandler();'
      );
      await write(
        "src/views/card/view.tsx",
        'import "./style.css"; export default function Card() { return <div>Built card</div>; }'
      );
      await write("src/views/card/style.css", "div { color: purple; }");
      await write("public/logo.svg", "<svg>embedded logo</svg>");
      await write(
        "src/skills/review/SKILL.md",
        "---\nname: review\ndescription: Review changes\n---\nEmbedded review skill\n"
      );
      await build({
        mode,
        envDir: "env",
        envPrefix: "APP_",
        define: {
          __APP_NAME__: JSON.stringify("configured-name"),
          __CLOSE_MARKER__: JSON.stringify(join(root, "closed.txt")),
        },
        resolve: { alias: { "@host": join(root, "src") } },
        environments: {
          ssr: {
            build: {
              ssr: true,
              outDir: ".output",
              rollupOptions: {
                input: join(root, "src/route.ts"),
                output: { entryFileNames: "index.mjs" },
              },
            },
          },
        },
        builder: {
          async buildApp(builder) {
            await builder.build(builder.environments.ssr!);
          },
        },
        plugins: [
          {
            name: "host-build-only-module",
            apply: "build",
            resolveId(id) {
              if (id === "virtual:host-config") return "\0host-config";
            },
            load(id) {
              if (id === "\0host-config") return 'export default "build-only";';
            },
          },
        ],
      });
      expect(await readFile(join(root, "closed.txt"), "utf8")).toBe("closed");
      await Promise.all(
        ["src", "public", "env", ".mcp-use"].map((path) =>
          rm(join(root, path), { recursive: true })
        )
      );

      // A fresh Node process exercises the deployed module graph, rather than
      // reusing the instance that build validation mounted and closed.
      const { stdout } = await execute(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
import { handleMcpRequest } from "./.output/index.mjs";
const origin = "http://localhost";
const request = (path, init) => handleMcpRequest(new Request(origin + path, init));
async function rpc(method, params = {}) {
  const response = await request("/mcp", { method:"POST", headers:{
    "content-type":"application/json", accept:"application/json, text/event-stream"
  }, body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}) });
  const text = await response.text();
  return JSON.parse(text.startsWith("event:")
    ? text.split("\\n").find(line => line.startsWith("data:")).slice(5) : text);
}
const config = await (await request("/mcp/config")).json();
const view = await rpc("resources/read", {uri:"ui://views/card.html"});
const html = view.result.contents[0].text;
const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map(match => match[1]).filter(url => url.includes("/_mcp-use/views/"));
const assets = await Promise.all(urls.map(async url => {
  const response = await handleMcpRequest(new Request(new URL(url, origin)));
  return {status:response.status, type:response.headers.get("content-type"), body:await response.text()};
}));
const skill = await rpc("resources/read", {uri:"skill://review/SKILL.md"});
const logo = await (await request("/mcp/_mcp-use/public/logo.svg")).text();
console.log(JSON.stringify({config, assets, skill, logo}));
`,
        ],
        { cwd: root }
      );
      const result = JSON.parse(stdout.trim().split("\n").at(-1)!);
      expect(result.config).toEqual({
        name: "configured-name",
        virtualValue: "build-only",
        aliasValue: "aliased",
        mode,
        production: true,
        envValue: mode,
      });
      expect(result.assets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ status: 200, type: "text/css" }),
          expect.objectContaining({
            status: 200,
            type: "application/javascript",
          }),
        ])
      );
      expect(result.skill.result.contents[0].text).toContain(
        "Embedded review skill"
      );
      expect(result.logo).toBe("<svg>embedded logo</svg>");
    }
  );

  it.each([
    ["export default {};", /default-export an MCPServer/],
    [
      'export default new MCPServer({name:"test",version:"1",basePath:"/wrong"});',
      /basePath mismatch/,
    ],
    [
      `const server = new MCPServer({name:"test",version:"1"});
server.tool({name:"orphan",outputSchema:z.object({}),view:{name:"missing"}},
  async () => ({content:[],structuredContent:{}}));
const close = server.close.bind(server);
server.close = async () => { await close(); await writeFile(__CLOSE_MARKER__, "closed"); };
export default server;`,
      /not in the primed views registry/,
    ],
  ])("rejects invalid compiled servers (%#)", async (source, message) => {
    await fixture(`import { MCPServer } from "mcp-use";
import { z } from "zod";
import { writeFile } from "node:fs/promises";
${source}`);
    await expect(build()).rejects.toThrow(message);
    if (source.includes("server.close =")) {
      expect(await readFile(join(root, "closed.txt"), "utf8")).toBe("closed");
    }
    await expect(
      readFile(join(root, ".mcp-use/vite/mcp/index.js"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
