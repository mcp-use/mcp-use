import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { StdioConnector } from "../../../src/transport/stdio.js";

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "mcp-stdio-lifecycle-"));
  const spawnLog = join(directory, "children.txt");
  writeFileSync(spawnLog, "");
  const pids = () =>
    readFileSync(spawnLog, "utf8").split("\n").filter(Boolean).map(Number);
  const connector = new StdioConnector({
    command: process.execPath,
    args: [
      fileURLToPath(
        new URL("../../fixtures/lifecycle-stdio-server.mjs", import.meta.url)
      ),
      spawnLog,
    ],
    protocolNegotiation: "legacy",
  });

  onTestFinished(async () => {
    // Run after assertions. Kill even children no longer owned by the connector
    // so a failing leak regression does not leak processes from the test itself.
    try {
      for (const pid of pids()) {
        if (isAlive(pid)) process.kill(pid, "SIGKILL");
      }
      await connector.disconnect();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  return { connector, pids };
}

describe("stdio lifecycle with a real child process", () => {
  it("shares one server across concurrent connects and terminates it on disconnect", async () => {
    const { connector, pids } = fixture();

    await Promise.all([
      connector.connect(),
      connector.connect(),
      connector.connect(),
    ]);
    expect(pids()).toHaveLength(1);
    expect(isAlive(pids()[0])).toBe(true);

    await Promise.all([connector.disconnect(), connector.disconnect()]);
    expect(connector.isClientConnected).toBe(false);
    await vi.waitFor(() => expect(pids().filter(isAlive)).toEqual([]), {
      timeout: 3000,
    });
  });

  it("leaves no child alive after connect/disconnect/connect/disconnect", async () => {
    const { connector, pids } = fixture();

    const firstConnect = connector.connect();
    const firstDisconnect = connector.disconnect();
    const reconnect = connector.connect();
    const finalDisconnect = connector.disconnect();
    const results = await Promise.allSettled([
      firstConnect,
      firstDisconnect,
      reconnect,
      finalDisconnect,
    ]);

    expect(results).toEqual([
      {
        status: "rejected",
        reason: new Error("Connection cancelled by disconnect"),
      },
      { status: "fulfilled", value: undefined },
      {
        status: "rejected",
        reason: new Error("Connection cancelled by disconnect"),
      },
      { status: "fulfilled", value: undefined },
    ]);
    // One startup was already in flight; cancellation must close it and must
    // not start a second child for the queued reconnect.
    expect(pids()).toHaveLength(1);
    expect(connector.isClientConnected).toBe(false);
    await vi.waitFor(() => expect(pids().filter(isAlive)).toEqual([]), {
      timeout: 3000,
    });
  });
});
