/** Follow landing links against real CLI listeners and the installed Inspector. */
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { tabLocator } from "./helpers/connection";

const packages = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const binary = join(packages, "server/dist/bin.js");

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("No port");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  return port;
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, "close");
  child.kill("SIGTERM");
  await closed;
}

for (const scenario of [
  {
    name: "built-in dev",
    command: "dev",
    custom: false,
    mounted: true,
    basePath: "/mcp",
  },
  {
    name: "custom dev",
    command: "dev",
    custom: true,
    mounted: true,
    basePath: "/api/mcp",
  },
  {
    name: "headless dev",
    command: "dev",
    custom: false,
    mounted: false,
    basePath: "/mcp",
  },
  {
    name: "custom production with Inspector",
    command: "start",
    custom: true,
    mounted: true,
    basePath: "/",
  },
  {
    name: "production without Inspector",
    command: "start",
    custom: false,
    mounted: false,
    basePath: "/mcp",
  },
  {
    name: "plain listen",
    command: "plain",
    custom: false,
    mounted: false,
    basePath: "/mcp",
  },
] as const) {
  test(`landing Inspector link: ${scenario.name}`, async ({
    page,
  }, testInfo) => {
    const cwd = await mkdtemp(join(tmpdir(), "mcp-landing-inspector-"));
    let child: ChildProcess | undefined;
    let logs = "";
    const launch = (args: string[]): ChildProcess => {
      const process = spawn(globalThis.process.execPath, args, {
        cwd,
        env: {
          ...globalThis.process.env,
          MCP_USE_ANONYMIZED_TELEMETRY: "false",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      process.stdout?.on("data", (data: Buffer) => {
        logs += data.toString();
      });
      process.stderr?.on("data", (data: Buffer) => {
        logs += data.toString();
      });
      return process;
    };
    try {
      await mkdir(join(cwd, "src"));
      await mkdir(join(cwd, "node_modules"));
      await writeFile(
        join(cwd, "package.json"),
        JSON.stringify({ type: "module", private: true })
      );
      for (const [name, target] of [
        ["mcp-use", join(packages, "server")],
        ["react", join(packages, "server/node_modules/react")],
        ["react-dom", join(packages, "server/node_modules/react-dom")],
      ]) {
        await symlink(target!, join(cwd, "node_modules", name!), "junction");
      }
      await writeFile(
        join(cwd, "src/index.ts"),
        `import { MCPServer } from "mcp-use";
const server = new MCPServer({ name: "landing-e2e", version: "1.0.0", basePath: ${JSON.stringify(scenario.basePath)} });
server.tool({ name: "landing_probe", description: "Verify landing auto-connect" }, async () => ({ content: [{ type: "text", text: "connected" }] }));
export default server;
`
      );
      if (scenario.custom) {
        await writeFile(
          join(cwd, "landing.tsx"),
          `import { useInstallTargets } from "mcp-use/landing";
export default function Landing() {
  const install = useInstallTargets();
  return <a href={install.inspector.url} target="_blank" rel="noopener noreferrer">Open in Inspector</a>;
}
`
        );
      }
      if (scenario.command === "start") {
        const build = launch([binary, "build"]);
        const [code] = await once(build, "close");
        expect(code, logs).toBe(0);
      }
      const port = await freePort();
      const endpoint = `http://localhost:${port}${scenario.basePath}`;
      child =
        scenario.command === "plain"
          ? launch([
              "--input-type=module",
              "-e",
              `const { default: server } = await import("./src/index.ts"); await server.listen(${port});`,
            ])
          : launch([
              binary,
              scenario.command,
              "--port",
              String(port),
              ...(scenario.command === "dev"
                ? ["--no-open", ...(scenario.mounted ? [] : ["--no-inspector"])]
                : scenario.mounted
                  ? ["--with-inspector"]
                  : []),
            ]);
      await expect
        .poll(
          async () => {
            if (child!.exitCode !== null) throw new Error(logs);
            return fetch(endpoint, { headers: { accept: "text/html" } })
              .then((r) => r.status)
              .catch(() => 0);
          },
          { timeout: 30_000 }
        )
        .toBe(200);
      await page.goto(endpoint);
      const link = page.getByRole("link", {
        name: "Open in Inspector",
        exact: true,
      });
      await expect(link).toBeVisible();
      const target = new URL((await link.getAttribute("href"))!);
      expect(target.searchParams.get("autoConnect")).toBe(endpoint);
      expect(target.searchParams.get("tab")).toBe("chat");
      if (scenario.mounted) {
        expect(target.origin).toBe(new URL(endpoint).origin);
        expect(target.pathname).toBe(
          `${scenario.basePath === "/" ? "" : scenario.basePath}/inspector`
        );
        const popupPromise = page.waitForEvent("popup");
        await link.click();
        const inspector = await popupPromise;
        await inspector.waitForLoadState("domcontentloaded");
        await tabLocator(inspector, "tools").click();
        await expect(
          inspector.getByText("landing_probe", { exact: true }).first()
        ).toBeVisible();
        await inspector.screenshot({
          path: testInfo.outputPath("connected-inspector.png"),
        });
      } else {
        expect(target.origin).toBe("https://inspector.manufact.com");
        const localPath = `${scenario.basePath === "/" ? "" : scenario.basePath}/inspector`;
        expect(
          (await page.request.get(new URL(localPath, endpoint).href)).status()
        ).toBe(404);
      }
    } finally {
      if (child !== undefined) await stop(child);
      await testInfo.attach("server.log", {
        body: logs,
        contentType: "text/plain",
      });
      await rm(cwd, { recursive: true, force: true });
    }
  });
}
