import assert from "node:assert/strict";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { Writable } from "node:stream";
import { setImmediate as nextTurn } from "node:timers/promises";

const [entry, fixture, spawnLog, mode, destroyMode] = process.argv.slice(2);
const { MCPSession, StdioConnector } = await import(entry);
let release;
let firstWritten;
const firstWrite = new Promise((resolve) => (firstWritten = resolve));
let tailWritten;
const tailWrite = new Promise((resolve) => (tailWritten = resolve));
let writes = 0;
const failure = new Error("DELAYED_ERRLOG_WRITE");
const errlog =
  destroyMode === "open-failure"
    ? createWriteStream(join(spawnLog, "errlog"))
    : new Writable({
        highWaterMark: 1,
        autoDestroy: destroyMode !== "disabled",
        write(_chunk, _encoding, callback) {
          release = callback;
          if (++writes === 1) firstWritten();
          else tailWritten();
        },
        ...(destroyMode === "delayed"
          ? {
              destroy(error, callback) {
                setImmediate(() => callback(error));
              },
            }
          : {}),
      });
const openFailed =
  destroyMode === "open-failure"
    ? new Promise((resolve) => errlog.once("close", resolve))
    : undefined;
const session = new MCPSession(
  new StdioConnector({
    command: process.execPath,
    args: [fixture, spawnLog, mode],
    errlog,
  })
);
try {
  await session.initialize();
  if (destroyMode === "open-failure") {
    await openFailed;
    assert.ok(errlog.errored);
    assert.equal(errlog.destroyed, true);
    assert.equal(session.isConnected, true);
    assert.ok(await session.callTool("ping", {}));
    await session.disconnect();
    assert.equal(errlog.listenerCount("error"), 0);
    console.log("STDERR_ERROR_HANDLED");
  } else {
    const client = session.connector.client;
    const previous = client.onclose;
    const closed = new Promise((resolve) => {
      client.onclose = () => {
        previous?.();
        resolve();
      };
    });
    await session.callTool("first", {});
    await firstWrite;
    await session.callTool(
      destroyMode.startsWith("destroy-before-callback") ? "exit" : "second",
      {}
    );
    if (mode === "natural") await closed;
    await session.disconnect();
    assert.equal(errlog.listenerCount("error"), 1);
    // No external error handler: a prematurely removed forwarding guard crashes
    // this host, which the parent test observes as a non-zero exit.
    const destinationClosed =
      destroyMode === "disabled"
        ? nextTurn()
        : new Promise((resolve) => errlog.once("close", resolve));
    if (destroyMode.startsWith("destroy-before-callback")) {
      errlog.destroy(failure);
      assert.equal(errlog.closed, true);
      release(destroyMode.endsWith("success") ? undefined : failure);
    } else {
      if (destroyMode === "tail-error") {
        release();
        await tailWrite;
        assert.equal(writes, 2);
        assert.equal(errlog.listenerCount("error"), 1);
      }
      release(failure);
    }
    await destinationClosed;
    if (destroyMode === "disabled") {
      assert.equal(errlog.destroyed, false);
      assert.equal(errlog.writableEnded, false);
      // A non-destroying sink keeps its error state; a fresh connection must
      // reject forwarding without retaining a guard for an already emitted error.
      await session.initialize();
      await session.callTool("first", {});
      await session.disconnect();
      assert.equal(errlog.destroyed, false);
    }
    assert.equal(errlog.listenerCount("error"), 0);
    console.log("STDERR_ERROR_HANDLED");
  }
} finally {
  await session.disconnect();
  errlog.destroy();
}
