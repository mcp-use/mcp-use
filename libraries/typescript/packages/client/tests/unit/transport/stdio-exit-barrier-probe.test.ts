import { Writable } from "node:stream";
import { setImmediate } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MCPConnection } from "../../../src/core/session.js";
import { StdioConnector } from "../../../src/transport/stdio.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

const helper = fileURLToPath(
  new URL("../../helpers/exit-barrier-server.mjs", import.meta.url)
);
const realStart = StdioClientTransport.prototype.start;
const transports: StdioClientTransport[] = [];
const pids: number[] = [];
const sessions: MCPConnection[] = [];
let observeChunk: (chunk: Buffer) => void;

function fixture(ignoreTerm = false) {
  let ready = deferred();
  const stdinClosed = deferred();
  const termIgnored = deferred();
  let pending = "";
  // Observe the real SDK stream independently of manager-owned piping: cleanup
  // can unpipe the caller's errlog before the child emits its shutdown markers.
  observeChunk = (chunk: Buffer) => {
    pending += String(chunk);
    let newline: number;
    while ((newline = pending.indexOf("\n")) !== -1) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      if (line === "READY") ready.resolve();
      if (line === "STDIN_CLOSED") stdinClosed.resolve();
      if (line === "TERM_IGNORED") termIgnored.resolve();
    }
  };
  const connector = new StdioConnector({
    command: process.execPath,
    args: [helper, ...(ignoreTerm ? ["--ignore-term"] : [])],
    errlog: new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
    }),
  });
  const session = new MCPConnection(connector, false);
  sessions.push(session);
  return {
    session,
    stdinClosed,
    termIgnored,
    get ready() {
      return ready.promise;
    },
    resetReady() {
      ready = deferred();
    },
  };
}

async function release(fail: boolean) {
  await transports.at(-1)!.send({
    jsonrpc: "2.0",
    method: "probe/release",
    params: { fail },
  });
}

function expectExited(pid: number) {
  expect(() => process.kill(pid, 0)).toThrowError(
    expect.objectContaining({ code: "ESRCH" })
  );
}

beforeEach(() => {
  vi.spyOn(StdioClientTransport.prototype, "start").mockImplementation(
    async function (this: StdioClientTransport) {
      this.stderr?.on("data", observeChunk);
      await realStart.call(this);
      if (this.pid === null) throw new Error("Missing child PID");
      transports.push(this);
      pids.push(this.pid);
    }
  );
});

afterEach(async () => {
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGUSR2");
    } catch {
      // This fixture's child already exited.
    }
  }
  await Promise.allSettled(sessions.map((session) => session.disconnect()));
  await Promise.allSettled(transports.map((transport) => transport.close()));
  sessions.length = transports.length = pids.length = 0;
  vi.restoreAllMocks();
});

describe("stdio exit barrier through MCPConnection", () => {
  it("keeps failed connect pending until gated exit and retries with a usable child", async () => {
    const f = fixture();
    let settled = false;
    const initial = Promise.allSettled([f.session.connect()]).then((result) => {
      settled = true;
      return result;
    });
    await f.ready;
    const oldPid = pids[0];
    await release(true);
    await Promise.race([f.stdinClosed.promise, initial]);
    // Flush promise callbacks after observing real EOF; no sleep is the oracle.
    await setImmediate();
    expect(settled).toBe(false);
    expect(() => process.kill(oldPid, 0)).not.toThrow();
    process.kill(oldPid, "SIGUSR2");
    const [outcome] = await initial;
    expect(outcome.status).toBe("rejected");
    if (outcome.status === "rejected") {
      expect(String(outcome.reason)).toContain("injected handshake failure");
    }
    expectExited(oldPid);
    expect(f.session.isConnected).toBe(false);

    f.resetReady();
    const retry = f.session.connect();
    await f.ready;
    expect(pids).toHaveLength(2);
    expectExited(oldPid);
    await release(false);
    await retry;
    await f.session.initialize();
    expect(await f.session.listTools()).toEqual([]);
    process.kill(pids[1], "SIGUSR2");
    await f.session.disconnect();
    expectExited(pids[1]);
  });

  it("reaps a child that ignores SIGTERM before failed connect settles", async () => {
    const f = fixture(true);
    const initial = Promise.allSettled([f.session.connect()]);
    await f.ready;
    await release(true);
    let termObserved = false;
    void f.termIgnored.promise.then(() => {
      termObserved = true;
    });
    const [outcome] = await initial;
    expect(outcome.status).toBe("rejected");
    expectExited(pids[0]);
    expect(termObserved).toBe(true);
    expect(f.session.isConnected).toBe(false);
  });
});
