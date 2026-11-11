/**
 * Run the built `mcp-use` CLI as a real child process.
 *
 * Tests drive the CLI the way agents and people do: argv in, exit code and
 * output out. The child gets a clean environment with a throwaway HOME, so
 * nothing from the developer's machine (API keys, ~/.mcp-use state) can leak
 * in, and nothing the CLI writes can leak out.
 *
 * The runner executes `dist/bin.js`, not `src/`. Rebuild after changing
 * source (`pnpm --filter @mcp-use/cli build`, about a second); the runner
 * refuses to run a `dist` that is older than `src` so a stale build cannot
 * make a broken change look green.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_DIR = fileURLToPath(new URL("../../", import.meta.url));
/** Absolute path to the built CLI entry. */
export const CLI_BIN = join(PACKAGE_DIR, "dist", "bin.js");

/** Environment variables passed through from the test process. */
const INHERITED_ENV = [
  "PATH",
  "TMPDIR",
  "TEMP",
  "TMP",
  // Windows needs these to start processes and resolve executables.
  "SystemRoot",
  "ComSpec",
  "PATHEXT",
] as const;

/** Where one CLI invocation runs. */
export interface CliSandbox {
  /** Throwaway HOME (also USERPROFILE on Windows). */
  home: string;
  /** Throwaway XDG_CONFIG_HOME, inside `home`. */
  configHome: string;
  /** Throwaway working directory. */
  cwd: string;
}

/** Per-call options. */
export interface RunOptions {
  /** Extra environment variables. They override the sandbox defaults. */
  env?: Record<string, string>;
  /** Working directory. Defaults to the sandbox `cwd`. */
  cwd?: string;
  /** Text written to stdin before it closes. Stdin is never a TTY. */
  input?: string;
  /** Kill the child after this many milliseconds. Defaults to 30 s. */
  timeoutMs?: number;
}

/** What one CLI invocation produced. */
export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /**
   * stdout parsed as exactly one JSON document, or `undefined` when stdout
   * is not a single JSON value. Two JSON lines therefore give `undefined`,
   * which is how a test catches a command that printed twice.
   */
  json: unknown;
  /** stderr parsed the same way, for `--json` error documents. */
  errorJson: unknown;
}

/**
 * Spawn `node dist/bin.js ...args` inside `sandbox`.
 *
 * This is asynchronous on purpose. The fake Cloud runs on this process's
 * event loop, so a synchronous spawn would block it and hang the CLI.
 */
export async function runCli(
  args: readonly string[],
  sandbox: CliSandbox,
  options: RunOptions = {}
): Promise<CliResult> {
  assertBuildIsCurrent();
  const env: Record<string, string> = {};
  for (const name of INHERITED_ENV) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  Object.assign(env, {
    HOME: sandbox.home,
    USERPROFILE: sandbox.home,
    XDG_CONFIG_HOME: sandbox.configHome,
    NO_COLOR: "1",
    MCP_USE_ANONYMIZED_TELEMETRY: "false",
    ...options.env,
  });

  const child = spawn(process.execPath, [CLI_BIN, ...args], {
    cwd: options.cwd ?? sandbox.cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
  child.stdin.end(options.input ?? "");

  const timeoutMs = options.timeoutMs ?? 30_000;
  const exitCode = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(
          `mcp-use ${args.join(" ")} did not exit within ${timeoutMs} ms.\n` +
            `stdout:\n${stdout}\nstderr:\n${stderr}`
        )
      );
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve(code ?? (signal !== null ? 128 : 1));
    });
  });

  return {
    exitCode,
    stdout,
    stderr,
    json: parseSingleJson(stdout),
    errorJson: parseSingleJson(stderr),
  };
}

function parseSingleJson(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

let checkedBuild = false;

/** Fail fast when `dist/bin.js` is missing or older than any source file. */
function assertBuildIsCurrent(): void {
  if (checkedBuild) return;
  const rebuild = "Run `pnpm --filter @mcp-use/cli build` first.";
  if (!existsSync(CLI_BIN)) {
    throw new Error(`The CLI is not built: ${CLI_BIN} is missing. ${rebuild}`);
  }
  const built = statSync(CLI_BIN).mtimeMs;
  const newest = newestMtime(join(PACKAGE_DIR, "src"));
  if (newest.mtimeMs > built) {
    throw new Error(
      `The CLI build is stale: ${newest.path} changed after ${CLI_BIN} was built. ${rebuild}`
    );
  }
  checkedBuild = true;
}

function newestMtime(directory: string): { path: string; mtimeMs: number } {
  let newest = { path: directory, mtimeMs: 0 };
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const candidate = entry.isDirectory()
      ? newestMtime(path)
      : { path, mtimeMs: statSync(path).mtimeMs };
    if (candidate.mtimeMs > newest.mtimeMs) newest = candidate;
  }
  return newest;
}
