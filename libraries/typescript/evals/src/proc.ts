import { spawn, type SpawnOptions } from "node:child_process";
import { delimiter } from "node:path";

/**
 * Environment for everything the harness spawns (agent subprocess, grader
 * commands, the server under test): the inherited env minus everything that
 * leaks the harness's own context into trials. Observed leaks (all flagged
 * as friction noise by the judge in real runs):
 * - `npm_*`/`PNPM_*` vars from running the harness under `pnpm eval` make
 *   every npm/npx call in the trial print "Unknown env config" warnings.
 * - `SHELL` pointing at the user's login shell makes the agent's Bash tool
 *   source their rc files (zoxide etc.), polluting every tool result.
 * - `PATH` entries for the monorepo's node_modules/.bin would let a bare
 *   `tsx`/`tsc` resolve from the repo instead of the sandbox's own install.
 * - `NODE_ENV` flips the server under test between dev/production behavior;
 *   trials must not depend on what the harness was started with.
 */
export function sanitizedEnv(
  base: NodeJS.ProcessEnv = process.env
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(base)) {
    if (/^(npm_|PNPM_)/i.test(key)) continue;
    env[key] = value;
  }
  if (env.PATH) {
    env.PATH = env.PATH.split(delimiter)
      .filter((p) => !p.includes("node_modules"))
      .join(delimiter);
  }
  env.SHELL = "/bin/bash";
  env._ZO_DOCTOR = "0"; // silence zoxide's doctor if a zsh still sneaks in
  delete env.NODE_ENV;
  return env;
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  onStdoutLine?: (line: string) => void;
}

/** Run a command to completion, capturing output. Kills the whole process group on timeout. */
export function run(
  cmd: string,
  args: string[],
  opts: RunOptions = {}
): Promise<RunResult> {
  return new Promise((resolve) => {
    const spawnOpts: SpawnOptions = {
      cwd: opts.cwd,
      env: opts.env ?? sanitizedEnv(),
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    };
    const child = spawn(cmd, args, spawnOpts);
    let stdout = "";
    let stderr = "";
    let lineBuf = "";
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;

    if (opts.timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true;
        killTree(child.pid);
      }, opts.timeoutMs);
    }

    child.stdout?.on("data", (d: Buffer) => {
      const text = d.toString();
      stdout += text;
      if (opts.onStdoutLine) {
        lineBuf += text;
        const lines = lineBuf.split("\n");
        lineBuf = lines.pop() ?? "";
        for (const line of lines) opts.onStdoutLine(line);
      }
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr + String(err), timedOut });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (opts.onStdoutLine && lineBuf) opts.onStdoutLine(lineBuf);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

/** Spawn a long-lived process (e.g. a dev server). Caller must call stop(). */
export function spawnDaemon(
  cmd: string,
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv }
): { pid: number | undefined; output: () => string; stop: () => void } {
  const child = spawn(cmd, args, {
    cwd: opts.cwd,
    env: opts.env ?? sanitizedEnv(),
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (d: Buffer) => (output += d.toString()));
  child.stderr?.on("data", (d: Buffer) => (output += d.toString()));
  child.on("error", (err) => (output += `\n[spawn error] ${String(err)}`));
  return {
    pid: child.pid,
    output: () => output,
    stop: () => killTree(child.pid),
  };
}

function killTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      process.kill(pid, "SIGTERM");
    } else {
      // negative pid = process group (requires detached: true)
      process.kill(-pid, "SIGTERM");
      setTimeout(() => {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          /* already gone */
        }
      }, 2000).unref();
    }
  } catch {
    /* already gone */
  }
}
