/**
 * Regression: StdioConnectionManager's `errlog` was a silent no-op. The manager
 * documents that the child's stderr is piped to `errlog`, but it spawned
 * StdioClientTransport without `stderr: "pipe"`, so the SDK defaulted to
 * "inherit", `transport.stderr` was null, and the forwarding block never ran.
 * These tests spawn real child processes, no mocks.
 */

import { describe, it, expect } from "vitest";
import { Writable } from "node:stream";
import { StdioConnectionManager } from "../../../src/transport/stdio.js";

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
          "process.stderr.write('ERR_MARKER_ERRLOG'); setTimeout(() => {}, 500)",
        ],
      },
      stream
    );

    const transport = await manager.start();
    // Client.connect() starts the transport in production; do it directly here
    // since no MCP handshake is involved.
    await transport.start();
    try {
      await new Promise<void>((resolve, reject) => {
        const deadline = setTimeout(() => {
          clearInterval(poll);
          reject(new Error(`errlog never received marker; got: "${data()}"`));
        }, 3000);
        const poll = setInterval(() => {
          if (data().includes("ERR_MARKER_ERRLOG")) {
            clearTimeout(deadline);
            clearInterval(poll);
            resolve();
          }
        }, 25);
      });
    } finally {
      await manager.stop();
    }

    expect(data()).toContain("ERR_MARKER_ERRLOG");
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
      expect(transport.stderr).toBeNull();
    } finally {
      await manager.stop();
    }
    expect(data()).toBe("");
  });
});
