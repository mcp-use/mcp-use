import {
  execFile,
  spawn,
  execFileSync as nodeExecFileSync,
} from "node:child_process";

/** Run a test-owned command with bounded execution and cancellation of its process tree. */
export function runProcess(
  file,
  args,
  { timeout = 30_000, signal, maxBuffer = 10 * 1024 * 1024, ...options } = {}
) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let cancelled;
    let escalation;
    let spawnError;
    let stdout = "";
    let stderr = "";
    const child = spawn(file, args, {
      ...options,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const kill = (force) => {
      if (!child.pid) return;
      if (process.platform === "win32") {
        execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], () => {});
      } else {
        try {
          process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM");
        } catch (error) {
          if (error.code !== "ESRCH") child.kill("SIGKILL");
        }
      }
    };
    const cancel = (reason) => {
      if (cancelled) return;
      cancelled = reason;
      kill(false);
      escalation = setTimeout(() => kill(true), 1_000);
    };
    const abort = () => cancel(signal.reason ?? new Error(`${file} aborted`));
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (data) => {
      stdout += data;
      if (stdout.length > maxBuffer)
        cancel(new Error("stdout exceeded maxBuffer"));
    });
    child.stderr.on("data", (data) => {
      stderr += data;
      if (stderr.length > maxBuffer)
        cancel(new Error("stderr exceeded maxBuffer"));
    });
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("spawn", () => {
      if (cancelled) kill(false);
    });
    child.once("close", (code, exitSignal) => {
      clearTimeout(timer);
      clearTimeout(escalation);
      signal?.removeEventListener("abort", abort);
      if (cancelled) {
        kill(true);
        reject(
          new Error(
            `${file} did not complete: ${String(cancelled)}\n${stderr}`,
            { cause: cancelled }
          )
        );
      } else if (spawnError) reject(spawnError);
      else if (code !== 0)
        reject(
          new Error(`${file} exited with ${exitSignal ?? code}\n${stderr}`)
        );
      else resolve({ stdout, stderr });
    });
    const timer = setTimeout(
      () => cancel(new Error(`timed out after ${timeout}ms`)),
      timeout
    );
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

/** Small synchronous Git setup commands must also have a deadline. */
export function execFileSync(file, args, options = {}) {
  return nodeExecFileSync(file, args, {
    timeout: 10_000,
    killSignal: "SIGKILL",
    ...options,
  });
}
