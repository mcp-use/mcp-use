/**
 * Regression: StdioConnectionManager's `errlog` parameter was a silent no-op.
 * The manager documented that the child's stderr is piped to `errlog`, but it
 * spawned StdioClientTransport without `stderr: "pipe"`, so the SDK defaulted
 * to "inherit", `transport.stderr` was always null, and the forwarding block
 * never ran (#1899). These tests spawn real child processes — no mocks.
 *
 * Run with: pnpm test tests/unit/client/stdio-errlog.test.ts
 */

import { describe, it, expect } from "vitest";
import { Writable } from "node:stream";
import { StdioConnectionManager } from "../../../src/task_managers/stdio.js";

function collector(): { stream: Writable; data: () => string } {
  let buf = "";
  const stream = new Writable({
    write(chunk, _enc, cb) {
      buf += chunk.toString();
      cb();
    },
  });
  return { stream, data: () => buf };
}

describe("StdioConnectionManager errlog", () => {
  it("pipes the child process stderr into the provided errlog stream", async () => {
    const { stream, data } = collector();
    const manager = new StdioConnectionManager(
      {
        command: process.execPath,
        args: [
          "-e",
          "process.stderr.write('ERR_MARKER_1899'); setTimeout(() => {}, 500)",
        ],
      },
      stream
    );

    const transport = await manager.start();
    // In production Client.connect() starts the transport (which spawns the
    // child); do it directly here since no MCP handshake is involved.
    await transport.start();
    try {
      await new Promise<void>((resolve, reject) => {
        const deadline = setTimeout(
          () => reject(new Error(`errlog never received marker; got: "${data()}"`)),
          3000
        );
        const poll = setInterval(() => {
          if (data().includes("ERR_MARKER_1899")) {
            clearTimeout(deadline);
            clearInterval(poll);
            resolve();
          }
        }, 25);
      });
    } finally {
      await manager.stop();
    }

    expect(data()).toContain("ERR_MARKER_1899");
  });

  it("respects an explicit stderr mode in server params over the pipe default", async () => {
    const { stream, data } = collector();
    const manager = new StdioConnectionManager(
      {
        command: process.execPath,
        args: ["-e", "setTimeout(() => {}, 200)"],
        stderr: "ignore",
      },
      stream
    );

    const transport = await manager.start();
    try {
      // With stderr explicitly "ignore", the SDK exposes no stderr stream and
      // nothing must be forwarded to errlog.
      expect(transport.stderr).toBeNull();
    } finally {
      await manager.stop();
    }
    expect(data()).toBe("");
  });
});
