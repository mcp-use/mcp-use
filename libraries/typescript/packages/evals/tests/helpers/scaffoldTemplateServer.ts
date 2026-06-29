import { existsSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type TemplateName = "blank" | "starter" | "mcp-apps";

export type ScaffoldedServer = {
  template: TemplateName;
  projectDir: string;
  port: number;
  baseUrl: string;
  mcpUrl: string;
  child: ChildProcess;
  cleanup: () => Promise<void>;
};

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, () => {
      const addr = srv.address();
      if (typeof addr === "object" && addr) {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("no port")));
      }
    });
  });
}

function runCmd(
  cmd: string,
  args: string[],
  cwd: string,
  env?: Record<string, string>
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `${cmd} ${args.join(" ")} failed (${code}): ${(stderr || stdout).slice(-4000)}`
          )
        );
    });
  });
}

async function waitForHealth(baseUrl: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(new URL("/inspector/health", baseUrl));
      if (res.ok) {
        const body = (await res.json()) as { status?: string };
        if (body.status === "ok") return;
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server not healthy at ${baseUrl} within ${timeoutMs}ms`);
}

function resolveCreateAppCli(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../../../create-mcp-use-app/dist/index.js"),
    path.resolve(here, "../../create-mcp-use-app/dist/index.js"),
    path.resolve(here, "../../../../create-mcp-use-app/dist/index.js"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(`create-mcp-use-app CLI not found; run pnpm build in libraries/typescript`);
}

export async function scaffoldTemplateServer(
  template: TemplateName
): Promise<ScaffoldedServer> {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), `mcp-eval-${template}-`));
  const projectDir = tmpRoot;
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const mcpUrl = `${baseUrl}/mcp`;

  const createCli = resolveCreateAppCli();
  await runCmd(
    process.execPath,
    [createCli, ".", "--template", template, "--no-skills", "--pnpm"],
    projectDir
  );

  await runCmd("pnpm", ["install", "--dangerously-allow-all-builds"], projectDir);
  await runCmd("pnpm", ["exec", "mcp-use", "build", "--with-inspector"], projectDir, {
    MCP_URL: baseUrl,
    PORT: String(port),
  });

  const child = spawn("pnpm", ["start"], {
    cwd: projectDir,
    env: {
      ...process.env,
      PORT: String(port),
      MCP_URL: baseUrl,
      HOST: "127.0.0.1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  await waitForHealth(baseUrl);

  const cleanup = async () => {
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    try {
      child.kill("SIGKILL");
    } catch {
      /* noop */
    }
    await rm(tmpRoot, { recursive: true, force: true });
  };

  return { template, projectDir, port, baseUrl, mcpUrl, child, cleanup };
}
