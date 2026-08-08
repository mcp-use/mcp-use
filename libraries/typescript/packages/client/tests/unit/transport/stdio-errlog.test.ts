/**
 * Regression: StdioConnectionManager's `errlog` was a silent no-op. The manager
 * documents that the child's stderr is piped to `errlog`, but it spawned
 * StdioClientTransport without `stderr: "pipe"`, so the SDK defaulted to
 * "inherit", `transport.stderr` was null, and the forwarding block never ran.
 * These tests spawn real child processes, no mocks.
 */

import { describe, it, expect } from "vitest";
import { Writable } from "node:stream";
import {
  StdioConnectionManager,
  type StdioStderrMode,
} from "../../../src/transport/stdio.js";

function collector(): {
  stream: Writable;
  data: () => string;
  ended: () => boolean;
} {
  let buf = "";
  let finished = false;
  const stream = new Writable({
    write(chunk, _enc, cb) {
      buf += chunk.toString();
      cb();
    },
    final(cb) {
      finished = true;
      cb();
    },
  });
  return { stream, data: () => buf, ended: () => finished };
}

/** A child that writes one stderr marker then idles so the pipe stays open. */
function markerChild(marker: string, linger = 500): string[] {
  return [
    "-e",
    `process.stderr.write(${JSON.stringify(marker)}); setTimeout(() => {}, ${linger})`,
  ];
}

/** Wait until `probe` is true, or fail with what was collected instead. */
async function waitFor(
  probe: () => boolean,
  describeFailure: () => string
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(() => {
      clearInterval(poll);
      reject(new Error(describeFailure()));
    }, 3000);
    const poll = setInterval(() => {
      if (probe()) {
        clearTimeout(deadline);
        clearInterval(poll);
        resolve();
      }
    }, 25);
  });
}

describe("StdioConnectionManager errlog", () => {
  it("pipes the child process stderr into the provided errlog stream", async () => {
    const { stream, data } = collector();
    const manager = new StdioConnectionManager(
      { command: process.execPath, args: markerChild("ERR_MARKER_ERRLOG") },
      stream
    );

    try {
      const transport = await manager.start();
      // Client.connect() starts the transport in production; do it directly
      // here since no MCP handshake is involved.
      await transport.start();
      await waitFor(
        () => data().includes("ERR_MARKER_ERRLOG"),
        () => `errlog never received marker; got: "${data()}"`
      );
    } finally {
      await manager.stop();
    }

    expect(data()).toContain("ERR_MARKER_ERRLOG");
  });

  it("leaves the caller-owned errlog open after the child exits", async () => {
    const { stream, data, ended } = collector();
    const manager = new StdioConnectionManager(
      { command: process.execPath, args: markerChild("ERR_MARKER_REUSE", 0) },
      stream
    );

    try {
      const transport = await manager.start();
      await transport.start();
      await waitFor(
        () => data().includes("ERR_MARKER_REUSE"),
        () => `errlog never received marker; got: "${data()}"`
      );
    } finally {
      await manager.stop();
    }

    // The pipe uses { end: false }, so one Writable survives across
    // reconnects and multiple connectors.
    expect(ended()).toBe(false);
    expect(stream.writableEnded).toBe(false);
  });

  it("handles errlog write failures and removes its listener on close", async () => {
    const stream = new Writable({
      write(_chunk, _enc, cb) {
        cb(new Error("ERRLOG_WRITE_FAILED"));
      },
    });
    const initialErrorListeners = stream.listenerCount("error");
    const manager = new StdioConnectionManager(
      { command: process.execPath, args: markerChild("ERR_MARKER_FAILURE") },
      stream
    );

    try {
      const transport = await manager.start();
      expect(stream.listenerCount("error")).toBeGreaterThan(
        initialErrorListeners
      );
      await transport.start();
      await waitFor(
        () => stream.destroyed,
        () => "errlog never reported its write failure"
      );
    } finally {
      await manager.stop();
    }

    expect(stream.listenerCount("error")).toBe(initialErrorListeners);
  });

  for (const mode of ["inherit", "ignore"] as StdioStderrMode[]) {
    it(`does not forward to errlog when stderr is "${mode}"`, async () => {
      const { stream, data } = collector();
      const manager = new StdioConnectionManager(
        {
          command: process.execPath,
          args: markerChild(`ERR_MARKER_${mode.toUpperCase()}`, 0),
          stderr: mode,
        },
        stream
      );

      try {
        const transport = await manager.start();
        // Actually spawn: the SDK creates the child in start(), not the
        // constructor, so without this the assertion would pass vacuously.
        await transport.start();
        expect(transport.stderr).toBeNull();
        // Give the child time to write and exit, so an accidental forward
        // would have landed by the time we assert.
        await new Promise((resolve) => setTimeout(resolve, 300));
      } finally {
        await manager.stop();
      }

      expect(data()).toBe("");
    });
  }
});
