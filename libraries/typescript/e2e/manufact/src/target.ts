/**
 * The scenario target, chosen by `E2E_TARGET=local|manufact` (PLAN.md §18.8.9).
 *
 * local:    runs the staged fixture (`E2E_FIXTURE_DIR`, from stage-fixture.mjs)
 *           with its vendored CLI (`npm ci`, `mcp-use build`, `mcp-use start`)
 *           on a free port, plus a local R1 receiver.
 * manufact: reads `<E2E_FIXTURE_DIR>/deployment.json` written by deploy.mjs and
 *           uses `E2E_RECEIVER_URL`/`E2E_RECEIVER_TOKEN`.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { startReceiver } from "../receiver/receiver.mjs";
import { waitUntil } from "./wait-until.js";

export type TargetKind = "local" | "manufact";

export interface Target {
  kind: TargetKind;
  /** The MCP endpoint, `<base>/mcp`. */
  mcpUrl: string;
  receiverUrl: string;
  receiverToken: string;
  /** `<runId>a<attempt>`, carried by every bucket and event id. */
  runTag: string;
  /** combo.json of the deployed build. */
  combo: Record<string, any>;
  /** Runtime log lines captured so far. */
  logs(): Promise<string[]>;
  close(): Promise<void>;
}

const env = (name: string) => {
  const v = process.env[name];
  return v === undefined || v === "" ? undefined : v;
};

export function targetKind(): TargetKind {
  const kind = env("E2E_TARGET") ?? "local";
  if (kind !== "local" && kind !== "manufact")
    throw new Error(`E2E_TARGET must be local or manufact, got ${kind}`);
  return kind;
}

/** True when a staged fixture is available, so scenarios can run at all. */
export function fixtureDir(): string | undefined {
  const dir = env("E2E_FIXTURE_DIR");
  return dir && existsSync(join(dir, "combo.json")) ? resolve(dir) : undefined;
}

async function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.once("error", fail);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => ok(port));
    });
  });
}

export async function openTarget(): Promise<Target> {
  const dir = fixtureDir();
  if (!dir)
    throw new Error(
      "E2E_FIXTURE_DIR must point at a staged fixture (stage-fixture.mjs)"
    );
  const combo = JSON.parse(readFileSync(join(dir, "combo.json"), "utf8"));
  const runTag = `${env("GITHUB_RUN_ID") ?? "0"}a${env("GITHUB_RUN_ATTEMPT") ?? "1"}`;
  return targetKind() === "local"
    ? openLocal(dir, combo, runTag)
    : openManufact(dir, combo, runTag);
}

async function openLocal(
  dir: string,
  combo: Record<string, any>,
  runTag: string
): Promise<Target> {
  const cli = join(dir, "node_modules", ".bin", "mcp-use");
  if (!existsSync(cli))
    execFileSync("npm", ["ci", "--no-audit", "--no-fund"], {
      cwd: dir,
      stdio: "inherit",
    });
  if (!existsSync(join(dir, ".mcp-use", "build")))
    execFileSync(cli, ["build"], { cwd: dir, stdio: "inherit" });

  const receiverToken = "local-receiver-token";
  const receiver = await startReceiver({ token: receiverToken });
  const port = await freePort();
  const lines: string[] = [];
  // TODO(events): set MCP_USE_PLATFORM_STORAGE_* to serverless-redis-http and run
  // createTestEgressProxy / runWakeLoop here once WP-24 and WP-26 land (§18.8.9).
  const child: ChildProcess = spawn(cli, ["start", "--port", String(port)], {
    cwd: dir,
    env: { ...process.env, PORT: String(port), NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const collect = (chunk: Buffer) =>
    lines.push(...chunk.toString("utf8").split("\n").filter(Boolean));
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  const base = `http://127.0.0.1:${port}`;
  await waitUntil(
    "fixture to listen",
    async () => {
      if (child.exitCode !== null)
        throw new Error(
          `fixture exited ${child.exitCode}: ${lines.slice(-5).join(" | ")}`
        );
      const res = await fetch(`${base}/mcp`, { method: "GET" }).catch(
        () => undefined
      );
      return res ? true : undefined;
    },
    { deadlineMs: 60_000 }
  );
  return {
    kind: "local",
    mcpUrl: `${base}/mcp`,
    receiverUrl: receiver.url,
    receiverToken,
    runTag,
    combo,
    logs: async () => [...lines],
    close: async () => {
      child.kill("SIGTERM");
      await receiver.close();
    },
  };
}

async function openManufact(
  dir: string,
  combo: Record<string, any>,
  runTag: string
): Promise<Target> {
  const deployment = JSON.parse(
    readFileSync(join(dir, "deployment.json"), "utf8")
  );
  const receiverUrl = env("E2E_RECEIVER_URL");
  const receiverToken = env("E2E_RECEIVER_TOKEN");
  if (!receiverUrl || !receiverToken)
    throw new Error("E2E_RECEIVER_URL and E2E_RECEIVER_TOKEN are required");
  const cli = join(dir, "node_modules", ".bin", "mcp-use");
  const base = String(deployment.url ?? deployment.mcpUrl).replace(
    /\/mcp\/?$/,
    ""
  );
  return {
    kind: "manufact",
    mcpUrl: `${base}/mcp`,
    receiverUrl,
    receiverToken,
    runTag,
    combo,
    logs: async () =>
      execFileSync(cli, ["logs", deployment.id, "--json"], { encoding: "utf8" })
        .split("\n")
        .filter(Boolean),
    close: async () => {},
  };
}
