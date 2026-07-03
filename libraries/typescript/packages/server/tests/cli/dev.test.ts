/**
 * e2e tests for runDev: a real Vite dev server + module runner serving the
 * fixture over HTTP, including edit-triggered reload and error resilience.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runDev } from "../../src/cli/index.js";
import {
  copyFixture,
  getFreePort,
  listToolNames,
  occupyPort,
  removeDir,
  waitFor,
} from "./helpers.js";

interface DevHandle {
  url: string;
  stop: () => Promise<void>;
}

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

/** Start runDev in-process and wait for the ready log to learn the URL. */
async function startDev(cwd: string, port: number): Promise<DevHandle> {
  const lines: string[] = [];
  const logSpy = vi
    .spyOn(console, "log")
    .mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });

  const controller = new AbortController();
  const done = runDev({ cwd, port, signal: controller.signal });
  // Surface startup failures instead of hanging in waitFor.
  let startupError: unknown;
  done.catch((error: unknown) => (startupError = error));

  try {
    const endpointLine = await waitFor(async () => {
      if (startupError !== undefined) throw startupError;
      return lines.find((l) => l.includes("MCP endpoint"));
    });
    const url = /(http:\/\/\S+)/.exec(endpointLine)?.[1];
    if (url === undefined) throw new Error(`no URL in: ${endpointLine}`);
    return {
      url,
      stop: async () => {
        controller.abort();
        await done;
        logSpy.mockRestore();
      },
    };
  } catch (error) {
    logSpy.mockRestore();
    controller.abort();
    await done.catch(() => {});
    throw error;
  }
}

describe("runDev", () => {
  it("serves the MCP endpoint and reloads on file change", async () => {
    const cwd = copyFixture("dev");
    cleanups.push(() => removeDir(cwd));

    const port = await getFreePort();
    const dev = await startDev(cwd, port);
    cleanups.push(dev.stop);

    expect(dev.url).toBe(`http://localhost:${port}/mcp`);
    expect(await listToolNames(dev.url)).toEqual(["add"]);

    // --- Edit-triggered reload: add a tool, poll until tools/list shows it.
    const entry = join(cwd, "src", "index.ts");
    const source = readFileSync(entry, "utf8");
    writeFileSync(
      entry,
      source.replace(
        "export default server;",
        `server.tool(
  { name: "subtract", description: "Subtract", schema: z.object({ a: z.number(), b: z.number() }) },
  async ({ a, b }) => ({ content: [{ type: "text", text: String(a - b) }] })
);
export default server;`
      )
    );
    await waitFor(async () =>
      (await listToolNames(dev.url)).includes("subtract") ? true : undefined
    );
    expect(await listToolNames(dev.url)).toEqual(["add", "subtract"]);

    // --- A broken save keeps the previous handler alive (never crashes).
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    cleanups.push(() => errorSpy.mockRestore());
    writeFileSync(entry, "this is not valid typescript {{{\n");
    await waitFor(async () =>
      errorSpy.mock.calls.some((call) =>
        String(call[0]).includes("reload failed")
      )
        ? true
        : undefined
    );
    expect(await listToolNames(dev.url)).toEqual(["add", "subtract"]);
  });

  it("probes upward when the requested port is taken", async () => {
    const cwd = copyFixture("dev-port");
    cleanups.push(() => removeDir(cwd));

    const port = await getFreePort();
    const blocker = await occupyPort(port);
    cleanups.push(
      () => new Promise<void>((r) => blocker.close(() => r()))
    );

    const dev = await startDev(cwd, port);
    cleanups.push(dev.stop);

    const boundPort = Number(new URL(dev.url).port);
    expect(boundPort).toBeGreaterThan(port);
    expect(await listToolNames(dev.url)).toEqual(["add"]);
  });

  it("rejects an entry without a default MCPServer export", async () => {
    const cwd = copyFixture("dev-bad");
    cleanups.push(() => removeDir(cwd));
    writeFileSync(join(cwd, "src", "index.ts"), "export const nope = 1;\n");

    const port = await getFreePort();
    await expect(runDev({ cwd, port })).rejects.toThrow(
      /export default server/
    );
  });
});
