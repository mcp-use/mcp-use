/** Run the built CLI and compete for its port while application import is paused. */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { CLI_BIN } from "../helpers/run-cli.js";
import {
  copyFixture,
  getFreePort,
  listToolNames,
  occupyPort,
  removeDir,
  waitFor,
} from "./helpers.js";

const cleanups: (() => void | Promise<unknown>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

function startDev(cwd: string, port: number) {
  const child = spawn(
    process.execPath,
    [
      CLI_BIN,
      "dev",
      "--port",
      String(port),
      "--host",
      "127.0.0.1",
      "--no-open",
      "--no-inspector",
    ],
    {
      cwd,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        HOME: cwd,
        USERPROFILE: cwd,
        XDG_CONFIG_HOME: cwd,
        NO_COLOR: "1",
        MCP_USE_ANONYMIZED_TELEMETRY: "false",
      },
      stdio: ["pipe", "pipe", "pipe"],
    }
  );
  let output = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk) => {
    output += chunk;
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  cleanups.push(async () => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await exited;
  });
  return { child, exited, output: () => output };
}

it.each([
  ["ephemeral", "entry"],
  ["available", "entry"],
  ["occupied", "entry"],
  ["ephemeral", "vite"],
  ["available", "vite"],
  ["occupied", "vite"],
] as const)(
  "retains the %s port during %s startup and serves the same port when ready",
  async (selection, stage) => {
    const cwd = copyFixture(`dev-retained-${selection}`);
    cleanups.push(() => removeDir(cwd));
    const gate = `
console.log("STARTUP_PORT=" + process.env.PORT);
await new Promise((resolve) => process.stdin.once("data", resolve));
// Windows cannot deliver SIGTERM through child.kill. Exercise Node's signal
// handlers through the same stdin channel used to release initialization.
process.stdin.once("data", () => {
  process.stdin.pause();
  process.emit("SIGTERM");
});
`;
    if (stage === "entry") {
      const entry = join(cwd, "src", "index.ts");
      writeFileSync(entry, gate + readFileSync(entry, "utf8"));
    } else {
      writeFileSync(join(cwd, "landing.tsx"), "export default () => null;");
      writeFileSync(join(cwd, "vite.config.ts"), gate + "export default {};");
    }
    const requested = selection === "ephemeral" ? 0 : await getFreePort();
    if (selection === "occupied") {
      const blocker = await occupyPort(requested);
      cleanups.push(
        () => new Promise<void>((resolve) => blocker.close(() => resolve()))
      );
    }
    const dev = startDev(cwd, requested);
    const port = await waitFor(async () => {
      const match = /STARTUP_PORT=(\d+)/.exec(dev.output());
      return match ? Number(match[1]) : undefined;
    });
    expect(port).toBeGreaterThan(0);
    if (selection === "available") expect(port).toBe(requested);
    if (selection === "occupied") expect(port).toBeGreaterThan(requested);

    // If selection merely probes and releases the port, this competitor wins.
    let competitor: Awaited<ReturnType<typeof occupyPort>> | undefined;
    try {
      await expect(
        occupyPort(port).then((server) => {
          competitor = server;
        })
      ).rejects.toMatchObject({ code: "EADDRINUSE" });
    } finally {
      const claimed = competitor;
      if (claimed)
        await new Promise<void>((resolve) => claimed.close(() => resolve()));
    }
    const pending = await fetch(`http://127.0.0.1:${port}/mcp`);
    expect(pending.status).toBe(503);
    await pending.text();
    expect(dev.output()).not.toContain("dev server ready");

    dev.child.stdin.write("continue\n");
    const endpoint = await waitFor(
      async () => /MCP endpoint:\s+(http:\/\/\S+)/.exec(dev.output())?.[1]
    );
    expect(endpoint).toBe(`http://localhost:${port}/mcp`);
    expect(dev.output().includes("is taken")).toBe(selection === "occupied");
    expect(await listToolNames(endpoint)).toEqual(["add"]);

    // A real HMR socket must share this already-listening server and close on shutdown.
    const socket = new WebSocket(`ws://127.0.0.1:${port}/`, "vite-hmr");
    cleanups.push(() => socket.close());
    const socketClosed = new Promise<void>((resolve) =>
      socket.addEventListener("close", () => resolve(), { once: true })
    );
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener(
        "message",
        (event) => {
          if (JSON.parse(String(event.data)).type === "connected") resolve();
        },
        { once: true }
      );
      socket.addEventListener(
        "error",
        () => reject(new Error("HMR connection failed")),
        { once: true }
      );
    });
    dev.child.stdin.end("stop\n");
    expect(await dev.exited).toBe(0);
    await socketClosed;
    const replacement = await occupyPort(port);
    await new Promise<void>((resolve) => replacement.close(() => resolve()));
  }
);
