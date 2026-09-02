import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(import.meta.url);
const windows = process.platform === "win32";

// Keep an ancestor alive until cleanup, even when the package manager exits.
// This also keeps the process-group ID from being reused during the check.
function supervise() {
  const { pm, cwd } = JSON.parse(process.env.MCP_SMOKE_OPTIONS);
  const report = (result) =>
    writeFileSync(process.env.MCP_SMOKE_STATUS, JSON.stringify(result));
  const child = spawn(pm, ["run", "dev"], {
    cwd,
    shell: windows, // Windows package-manager shims are .cmd files.
    stdio: "inherit",
  });
  child.once("error", (error) => report({ error: error.message }));
  child.once("exit", (code, signal) => report({ code, signal }));
  setInterval(() => {}, 1000);
  // Let the controller reap every member of the group before its leader exits.
  if (!windows) process.on("SIGTERM", () => {});
}

export async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

export async function smokeTest({
  pm,
  cwd = process.cwd(),
  timeoutMs = 90_000,
  stableMs = 1000,
  signal,
}) {
  if (!["npm", "yarn", "pnpm"].includes(pm)) {
    throw new Error(`Unsupported package manager: ${pm}`);
  }
  const port = await availablePort();
  const url = `http://127.0.0.1:${port}/mcp`;
  const scratch = mkdtempSync(join(tmpdir(), "mcp-use-dev-smoke-"));
  const statusFile = join(scratch, "exit.json");
  const env = {
    ...process.env,
    PORT: String(port),
    BROWSER: "none",
    MCP_USE_ANONYMIZED_TELEMETRY: "false",
    MCP_SMOKE_OPTIONS: JSON.stringify({ pm, cwd: resolve(cwd) }),
    MCP_SMOKE_STATUS: statusFile,
    MCP_SMOKE_NODE: process.execPath,
    MCP_SMOKE_SCRIPT: script,
  };
  const child = windows
    ? spawn(
        "powershell.exe",
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          fileURLToPath(
            new URL("./dev-server-smoke-windows.ps1", import.meta.url),
          ),
        ],
        { env, stdio: ["ignore", "pipe", "pipe"] },
      )
    : spawn(process.execPath, [script, "--supervise"], {
        env,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
  let output = "";
  let exited;
  let closed = false;
  let failure;
  let lastProbe = "no response";
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      output = (output + chunk).slice(-256 * 1024);
    });
  }
  child.once("error", (error) => {
    exited = `launch error: ${error.message}`;
  });
  child.once("exit", (code, signal) => {
    exited = `supervisor exited (code ${code}, signal ${signal})`;
  });
  child.once("close", () => {
    closed = true;
  });
  const checkRunning = () => {
    signal?.throwIfAborted();
    if (exited) throw new Error(exited);
    if (existsSync(statusFile)) {
      // The supervisor is the only writer. An incomplete write is still an exit.
      throw new Error(
        `Dev command exited before the check completed: ${readFileSync(statusFile, "utf8")}`,
      );
    }
  };

  try {
    const deadline = Date.now() + timeoutMs;
    let readySince;
    while (Date.now() < deadline) {
      checkRunning();
      let ready = false;
      try {
        const response = await fetch(url, {
          redirect: "manual",
          signal: AbortSignal.timeout(
            Math.min(1000, Math.max(1, deadline - Date.now())),
          ),
        });
        lastProbe = `HTTP ${response.status}`;
        ready = response.status === 204;
        await response.body?.cancel();
      } catch (error) {
        lastProbe = error.message;
      }
      checkRunning();
      if (ready) {
        readySince ??= Date.now();
        if (Date.now() - readySince >= stableMs) break;
      } else {
        readySince = undefined;
      }
      await delay(100);
    }
    checkRunning();
    if (readySince === undefined || Date.now() - readySince < stableMs) {
      throw new Error(
        `Readiness timeout after ${timeoutMs}ms (last probe: ${lastProbe})`,
      );
    }
  } catch (error) {
    failure = error;
  } finally {
    try {
      if (child.pid) {
        if (windows) {
          // Terminating the native supervisor closes its non-inherited Job
          // Object handle, which kills every descendant, including orphans.
          if (!exited) child.kill("SIGKILL");
        } else {
          const killGroup = (signal) => {
            try {
              process.kill(-child.pid, signal);
            } catch (error) {
              if (error.code !== "ESRCH") throw error;
            }
          };
          killGroup("SIGTERM");
          await delay(500);
          killGroup("SIGKILL");
        }
      }
      const deadline = Date.now() + 5000;
      while (!closed && Date.now() < deadline) await delay(50);
      if (!closed) throw new Error("Process-tree cleanup timed out");
      // A remaining listener is a failure, never something to kill by port.
      const probe = createServer();
      await new Promise((resolve, reject) => {
        probe.once("error", reject);
        probe.listen(port, "127.0.0.1", () => probe.close(resolve));
      });
    } catch (error) {
      failure = new Error(
        `${failure ? `${failure.message}; ` : ""}Cleanup failed: ${error.message}`,
      );
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
    }
    rmSync(scratch, { recursive: true, force: true });
  }
  if (failure) {
    throw new Error(
      `${pm} run dev in ${resolve(cwd)}\nReadiness URL: ${url}\n${failure.message}\n--- dev server logs (last 256 KiB) ---\n${output || "(no output)"}`,
    );
  }
  return { port, output };
}

if (process.argv[1] && resolve(process.argv[1]) === script) {
  if (process.argv[2] === "--supervise") {
    supervise();
  } else {
    const controller = new AbortController();
    for (const signal of ["SIGINT", "SIGTERM"]) {
      process.on(signal, () =>
        controller.abort(new Error(`Interrupted by ${signal}`)),
      );
    }
    try {
      await smokeTest({ pm: process.argv[2], signal: controller.signal });
      console.log(
        "Dev server became ready and its process tree was cleaned up successfully",
      );
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
