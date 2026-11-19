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
import { afterEach, describe, expect, it } from "vitest";

const execute = promisify(execFile);
const serverRoot = join(import.meta.dirname, "..");
let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

describe("production CLI view cache keys", () => {
  it.each([false, true])(
    "versions deployed view URIs by view content (inline=%s)",
    async (inline) => {
      root = await mkdtemp(join(import.meta.dirname, ".view-build-"));
      await mkdir(join(root, "views/dashboard"), { recursive: true });
      await mkdir(join(root, "node_modules"));
      await symlink(serverRoot, join(root, "node_modules/mcp-use"));
      await writeFile(join(root, "package.json"), '{"type":"module"}');
      const writeEntry = (extraTool = "") =>
        writeFile(
          join(root!, "index.ts"),
          `
import { MCPServer } from "mcp-use";
import { z } from "zod";
const server = new MCPServer({name:"built-view",version:"1"});
server.tool({name:"dashboard",outputSchema:z.object({}),view:{name:"dashboard"}},
  async () => ({content:[],structuredContent:{}}));
${extraTool}
export default server;
`
        );
      const writeView = (label: string) =>
        writeFile(
          join(root!, "views/dashboard/view.tsx"),
          `export default function Dashboard() { return <div>${label}</div>; }`
        );
      await writeEntry();
      await writeView("Dashboard");
      const build = () =>
        execute(
          process.execPath,
          [
            join(serverRoot, "dist/bin.js"),
            "build",
            ...(inline ? ["--inline"] : []),
          ],
          {
            cwd: root,
            env: { ...process.env, NODE_ENV: "production" },
          }
        );
      const inspect = async () => {
        const { stdout } = await execute(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            `
import server from "./.mcp-use/build/index.js";
const response = await server.fetch(new Request("http://localhost/mcp", {
  method:"POST", headers:{"content-type":"application/json",accept:"application/json, text/event-stream"},
  body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/list",params:{}})
}));
const text = await response.text();
const body = JSON.parse(text.startsWith("event:") ? text.split("\\n").find(line => line.startsWith("data:")).slice(5) : text);
console.log(JSON.stringify(body));
await server.close();
`,
          ],
          { cwd: root }
        );
        return JSON.parse(stdout.trim().split("\n").at(-1)!);
      };
      const advertisedUri = async () => {
        const result = await inspect();
        const uri = result.result.tools[0]._meta.ui.resourceUri;
        expect(result.result.tools[0]._meta["ui/resourceUri"]).toBe(uri);
        return uri as string;
      };

      await build();
      const first = await advertisedUri();
      expect(first).toMatch(/^ui:\/\/views\/dashboard-[0-9a-f]{16}\.html$/);
      // Another replica of the same artifact advertises the same URI.
      expect(await advertisedUri()).toBe(first);

      // Rebuilding identical sources keeps the URI.
      await build();
      expect(await advertisedUri()).toBe(first);

      // A backend-only change keeps the URI.
      await writeEntry(
        `server.tool({name:"ping"}, async () => ({content:[{type:"text",text:"pong"}]}));`
      );
      await build();
      expect(await advertisedUri()).toBe(first);

      // Changing the view changes its URI.
      await writeView("Dashboard v2");
      await build();
      const changed = await advertisedUri();
      expect(changed).toMatch(/^ui:\/\/views\/dashboard-[0-9a-f]{16}\.html$/);
      expect(changed).not.toBe(first);
    }
  );
});
