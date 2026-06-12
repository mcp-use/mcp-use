import { access, readFile } from "node:fs/promises";
import { createServer, connect } from "node:net";
import { join } from "node:path";
import { MCPClient } from "mcp-use";
import { run, sanitizedEnv, spawnDaemon } from "../proc.js";
import type {
  CheckResult,
  Expectation,
  OutcomeGrade,
  TaskConfig,
} from "../types.js";

const WEIGHTS = { compiles: 20, starts: 20, tools: 30, calls: 30 } as const;
/** auth tasks add a 5th check; weights reallocate so the ladder still sums to 100 */
const AUTH_WEIGHTS = {
  compiles: 15,
  starts: 15,
  auth: 20,
  tools: 25,
  calls: 25,
} as const;
type CheckId = keyof typeof AUTH_WEIGHTS;
const START_TIMEOUT_MS = 30_000;

export async function gradeOutcome(
  workspace: string,
  task: TaskConfig
): Promise<OutcomeGrade> {
  const weights: Partial<Record<CheckId, number>> = task.auth
    ? AUTH_WEIGHTS
    : WEIGHTS;
  const checkIds = Object.keys(weights) as CheckId[];
  const checks: CheckResult[] = [];
  const fail = (id: CheckId, detail: string) =>
    checks.push({ id, weight: weights[id]!, passed: false, detail });
  const pass = (id: CheckId, detail?: string) =>
    checks.push({ id, weight: weights[id]!, passed: true, detail });

  if (!(await exists(join(workspace, "package.json")))) {
    for (const id of checkIds) fail(id, "no package.json in workspace");
    return finalize(checks);
  }

  // Precondition, not scored: the contract says the project must install; if the
  // agent didn't leave node_modules behind, install before grading.
  if (!(await exists(join(workspace, "node_modules")))) {
    const install = await run(
      "npm",
      ["install", "--no-audit", "--no-fund", "--loglevel=error"],
      {
        cwd: workspace,
        timeoutMs: 5 * 60_000,
      }
    );
    if (install.code !== 0) {
      for (const id of checkIds)
        fail(id, `npm install failed: ${tail(install.stderr)}`);
      return finalize(checks);
    }
  }

  // 1. compiles
  if (!(await exists(join(workspace, "tsconfig.json")))) {
    fail(
      "compiles",
      "no tsconfig.json (contract requires a typechecking TypeScript project)"
    );
  } else {
    const tsc = await run("npx", ["-y", "tsc", "--noEmit"], {
      cwd: workspace,
      timeoutMs: 180_000,
    });
    if (tsc.code === 0) pass("compiles");
    else
      fail(
        "compiles",
        `tsc --noEmit failed:\n${tail(tsc.stdout + tsc.stderr)}`
      );
  }

  // 2. starts
  const entry = await findEntry(workspace, task.entryCandidates);
  if (!entry) {
    fail(
      "starts",
      `no entry file found (tried: ${task.entryCandidates.join(", ")})`
    );
    if (task.auth) fail("auth", "server not running");
    fail("tools", "server not running");
    fail("calls", "server not running");
    return finalize(checks);
  }

  const port = await freePort();
  const server = spawnDaemon("npx", ["-y", "tsx", entry], {
    cwd: workspace,
    env: {
      ...sanitizedEnv(),
      PORT: String(port),
      NODE_ENV: "production",
      ...(task.auth ? { [task.auth.tokenEnv]: task.auth.token } : {}),
    },
  });

  let activePort: number | null = null;
  try {
    if (await waitForPort(port, START_TIMEOUT_MS)) {
      activePort = port;
      pass("starts", `entry ${entry}, port ${port} (PORT env respected)`);
    } else if (await waitForPort(3000, 2_000)) {
      // Started, but ignored the PORT env var — contract violation, yet the server
      // is up: fail "starts", keep grading downstream checks against :3000.
      activePort = 3000;
      fail(
        "starts",
        `server ignored PORT env (came up on hardcoded :3000). Entry: ${entry}`
      );
    } else {
      fail(
        "starts",
        `server did not come up within ${START_TIMEOUT_MS}ms. Output:\n${tail(server.output())}`
      );
      if (task.auth) fail("auth", "server not running");
      fail("tools", "server not running");
      fail("calls", "server not running");
      return finalize(checks);
    }

    // 3. auth — unauthenticated and wrong-token requests must be rejected with 401.
    // Probed with raw fetch (a well-formed initialize request) so a legitimate
    // implementation is never failed for transport reasons.
    if (task.auth) {
      const problems: string[] = [];
      const noToken = await probeMcpStatus(activePort);
      if (noToken !== 401)
        problems.push(
          `request without Authorization header → HTTP ${noToken ?? "unreachable"} (expected 401)`
        );
      const wrongToken = await probeMcpStatus(
        activePort,
        "definitely-not-the-accepted-token"
      );
      if (wrongToken !== 401)
        problems.push(
          `request with a wrong bearer token → HTTP ${wrongToken ?? "unreachable"} (expected 401)`
        );
      if (problems.length === 0)
        pass("auth", "401 for missing and wrong bearer token");
      else fail("auth", problems.join("; "));
    }

    // 4 + 5. tools listed / calls correct — graded with our own MCPClient,
    // authenticating with the task's bearer token when the task requires auth
    const client = new MCPClient({
      mcpServers: {
        sut: {
          url: `http://localhost:${activePort}/mcp`,
          ...(task.auth ? { authToken: task.auth.token } : {}),
        },
      },
    });
    try {
      await client.createAllSessions();
      const session = client.getSession("sut");
      if (!session)
        throw new Error("no session created for the server under test");
      const tools = (await session.listTools()) as Array<
        Record<string, unknown>
      >;

      const toolProblems: string[] = [];
      for (const expected of task.expectedTools) {
        const tool = tools.find((t) => t.name === expected.name);
        if (!tool) {
          toolProblems.push(
            `tool "${expected.name}" not listed (got: ${tools.map((t) => t.name).join(", ") || "none"})`
          );
          continue;
        }
        const props = schemaProps(tool);
        for (const p of expected.requiredProps ?? []) {
          if (!(p in props))
            toolProblems.push(
              `tool "${expected.name}" schema missing property "${p}"`
            );
        }
      }
      if (toolProblems.length === 0) pass("tools");
      else fail("tools", toolProblems.join("; "));

      const callProblems: string[] = [];
      for (const call of task.calls) {
        try {
          const result = (await session.callTool(
            call.tool,
            call.args
          )) as Record<string, unknown>;
          const text = flattenCallResult(result);
          if (!matchExpectation(text, call.expect)) {
            callProblems.push(
              `${call.tool}(${JSON.stringify(call.args)}) → "${truncate(text, 120)}" did not match ${JSON.stringify(call.expect)}`
            );
          }
        } catch (err) {
          callProblems.push(
            `${call.tool}(${JSON.stringify(call.args)}) threw: ${truncate(String(err), 200)}`
          );
        }
      }
      if (callProblems.length === 0) pass("calls");
      else fail("calls", callProblems.join("; "));

      await client.closeAllSessions();
    } catch (err) {
      fail(
        "tools",
        `MCP client could not connect to http://localhost:${activePort}/mcp: ${truncate(String(err), 300)}`
      );
      fail("calls", "MCP client could not connect");
    }
  } finally {
    server.stop();
  }

  return finalize(checks);
}

/** Extract input-schema property names, tolerating MCP/SDK naming variants. */
function schemaProps(tool: Record<string, unknown>): Record<string, unknown> {
  for (const key of ["inputSchema", "input_schema", "parameters"]) {
    const schema = tool[key];
    if (
      schema &&
      typeof schema === "object" &&
      "properties" in (schema as object)
    ) {
      const props = (schema as { properties?: unknown }).properties;
      if (props && typeof props === "object")
        return props as Record<string, unknown>;
    }
  }
  return {};
}

export function flattenCallResult(result: Record<string, unknown>): string {
  const parts: string[] = [];
  if (Array.isArray(result.content)) {
    for (const block of result.content as Array<Record<string, unknown>>) {
      if (block.type === "text" && typeof block.text === "string")
        parts.push(block.text);
    }
  }
  if (result.structuredContent !== undefined)
    parts.push(JSON.stringify(result.structuredContent));
  return parts.join(" ");
}

export function matchExpectation(text: string, expect: Expectation): boolean {
  if (expect.type === "contains") return text.includes(String(expect.value));
  if (expect.type === "not-contains")
    return !text.includes(String(expect.value));
  // number-equals: tolerate prose around the number ("The sum is 5")
  const matches = text.match(/-?\d+(?:\.\d+)?/g);
  return (matches ?? []).some((m) => Number(m) === Number(expect.value));
}

/**
 * POST a well-formed MCP initialize request and return the HTTP status
 * (null when unreachable). Used by the auth check: the request is valid in
 * every way except the bearer token, so only the auth layer can reject it.
 */
async function probeMcpStatus(
  port: number,
  token?: string
): Promise<number | null> {
  try {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "eval-auth-probe", version: "0.0.0" },
        },
      }),
    });
    await res.body?.cancel();
    return res.status;
  } catch {
    return null;
  }
}

async function findEntry(
  workspace: string,
  candidates: string[]
): Promise<string | null> {
  for (const c of candidates) {
    if (await exists(join(workspace, c))) return c;
  }
  return null;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, () => {
      const address = srv.address();
      if (address && typeof address === "object") {
        const port = address.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("could not allocate port")));
      }
    });
  });
}

async function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // The server may bind IPv4 or IPv6 loopback only (mcp-use 1.32 binds ::1) — probe both.
    for (const host of ["127.0.0.1", "::1"]) {
      const up = await new Promise<boolean>((resolve) => {
        const sock = connect({ port, host }, () => {
          sock.destroy();
          resolve(true);
        });
        sock.on("error", () => resolve(false));
        sock.setTimeout(1000, () => {
          sock.destroy();
          resolve(false);
        });
      });
      if (up) return true;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function finalize(checks: CheckResult[]): OutcomeGrade {
  const score = checks
    .filter((c) => c.passed)
    .reduce((sum, c) => sum + c.weight, 0);
  return {
    score,
    success: checks.length > 0 && checks.every((c) => c.passed),
    checks,
  };
}

function tail(s: string, n = 1500): string {
  const t = s.trim();
  return t.length > n ? `…${t.slice(-n)}` : t;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** Read the resolved mcp-use version the agent's project actually installed. */
export async function installedSdkVersion(
  workspace: string
): Promise<string | null> {
  try {
    const pkg = JSON.parse(
      await readFile(
        join(workspace, "node_modules", "mcp-use", "package.json"),
        "utf8"
      )
    );
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}
