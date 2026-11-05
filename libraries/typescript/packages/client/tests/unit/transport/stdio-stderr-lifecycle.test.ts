import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { MCPSession } from "../../../src/core/session.js";
import { StdioConnector } from "../../../src/transport/stdio.js";
import { deferred } from "../../helpers/deferred.js";

const server = fileURLToPath(
  new URL("../../fixtures/stderr-lifecycle-server.mjs", import.meta.url)
);

function processJournal() {
  const directory = mkdtempSync(join(tmpdir(), "mcp-stderr-lifecycle-"));
  const spawnLog = join(directory, "children.txt");
  writeFileSync(spawnLog, "");
  const pids = () =>
    readFileSync(spawnLog, "utf8").split("\n").filter(Boolean).map(Number);
  onTestFinished(() => {
    for (const pid of pids()) {
      try {
        process.kill(pid, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }
    rmSync(directory, { recursive: true, force: true });
  });
  return { spawnLog, pids };
}

class ObservableStdioConnector extends StdioConnector {
  observeClose(): Promise<void> {
    const client = this.client!;
    const previous = client.onclose;
    const closed = deferred();
    client.onclose = () => {
      previous?.();
      closed.resolve();
    };
    return closed.promise;
  }
}

describe("stdio stderr cleanup with a backpressured destination", () => {
  it.each(["natural", "explicit"])(
    "drains the tail after %s exit without delaying disconnect or ending errlog",
    async (mode) => {
      const { spawnLog, pids } = processJournal();
      const chunks: string[] = [];
      const firstWrite = deferred();
      let release: (() => void) | undefined;
      const errlog = new Writable({
        highWaterMark: 1,
        write(chunk, _encoding, callback) {
          chunks.push(chunk.toString());
          if (chunks.length === 1) {
            release = callback;
            firstWrite.resolve();
          } else callback();
        },
      });
      const connector = new ObservableStdioConnector({
        command: process.execPath,
        args: [server, spawnLog, mode],
        errlog,
      });
      const session = new MCPSession(connector);
      onTestFinished(async () => {
        release?.();
        release = undefined;
        await session.disconnect();
        errlog.destroy();
      });
      await session.initialize();
      const closed = connector.observeClose();
      await session.callTool("first", {});
      await firstWrite.promise;
      await session.callTool("second", {});
      if (mode === "natural") await closed;
      await session.disconnect();
      expect(session.isConnected).toBe(false);
      expect(chunks.join("")).toBe("FIRST");

      // Reconnect is independent of the old destination write callback.
      await session.initialize();
      expect(pids()).toHaveLength(2);
      expect(await session.callTool("ping", {})).toMatchObject({
        content: [{ type: "text", text: String(pids()[1]) }],
      });
      release!();
      release = undefined;
      await vi.waitFor(() => expect(chunks.join("")).toBe("FIRSTSECOND"));
      expect(errlog.destroyed).toBe(false);
      expect(errlog.writableEnded).toBe(false);
      await session.disconnect();
      await vi.waitFor(() => expect(errlog.listenerCount("error")).toBe(0));
    },
    5000
  );

  it("reconnects while an errlog write never invokes its callback", async () => {
    const { spawnLog, pids } = processJournal();
    const firstWrite = deferred();
    const errlog = new Writable({
      highWaterMark: 1,
      write() {
        firstWrite.resolve();
      },
    });
    const connector = new ObservableStdioConnector({
      command: process.execPath,
      args: [server, spawnLog, "natural"],
      errlog,
    });
    const session = new MCPSession(connector);
    onTestFinished(async () => {
      await session.disconnect();
      errlog.destroy();
    });
    await session.initialize();
    const closed = connector.observeClose();
    await session.callTool("first", {});
    await firstWrite.promise;
    await session.callTool("second", {});
    await closed;
    await session.disconnect();
    await Promise.all([session.connect(), session.connect()]);
    expect(pids()).toHaveLength(2);
    expect(await session.callTool("ping", {})).toMatchObject({
      content: [{ type: "text", text: String(pids()[1]) }],
    });
    await session.disconnect();
    expect(session.isConnected).toBe(false);
    expect(errlog.destroyed).toBe(false);
    expect(errlog.writableEnded).toBe(false);
    // The test owns this destination; closing it releases the outstanding
    // forwarding guard even though its write callback never ran.
    errlog.destroy();
    await vi.waitFor(() => expect(errlog.listenerCount("error")).toBe(0));
  }, 5000);

  it.each([
    ["natural", "default"],
    ["natural", "delayed"],
    ["explicit", "default"],
    ["natural", "disabled"],
    ["natural", "destroy-before-callback-error"],
    ["natural", "destroy-before-callback-success"],
    ["natural", "open-failure"],
  ])(
    "handles errlog errors with %s exit and %s ordering",
    async (mode, destroyMode) => {
      const { spawnLog } = processJournal();
      const host = fileURLToPath(
        new URL("../../fixtures/stderr-error-host.mjs", import.meta.url)
      );
      // Like browser-entry tests, exercise the package build as consumers load
      // it. Isolating the host makes an unhandled stream error a real crash.
      const { stdout, stderr } = await promisify(execFile)(
        process.execPath,
        [
          host,
          new URL("../../../dist/index.js", import.meta.url).href,
          server,
          spawnLog,
          mode,
          destroyMode,
        ],
        {
          timeout: 5000,
          env: { ...process.env, MCP_USE_ANONYMIZED_TELEMETRY: "false" },
        }
      );
      expect(stdout).toContain("STDERR_ERROR_HANDLED");
      expect(stdout + stderr).toContain(
        destroyMode === "open-failure"
          ? "Error writing child stderr to errlog"
          : "DELAYED_ERRLOG_WRITE"
      );
    }
  );
});
