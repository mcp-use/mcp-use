import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const exec = promisify(execFile);

it("releases closed stream controllers even when a custom bus retains callbacks", async () => {
  // A separate process enables forced GC and tests emitted artifacts without
  // Vitest transforms. A successful unsubscribe is the collection control.
  const dist = new URL("../../dist/", import.meta.url).href;
  const { stdout } = await exec(process.execPath, [
    "--expose-gc",
    "--input-type=module",
    "-e",
    `
    import assert from "node:assert/strict";
    import { Server } from "@modelcontextprotocol/server";

    const dist = ${JSON.stringify(dist)};
    const tick = () => new Promise(resolve => setImmediate(resolve));
    const results = [];
    async function probe(createMcpMount, fail) {
      const callbacks = new Set();
      const controllers = [];
      let target;
      const bus = {
        publish(event) { for (const callback of callbacks) callback(event); },
        subscribe(callback) {
          callbacks.add(callback);
          target = controllers.at(-1);
          return () => {
            if (fail) throw new Error("expected unsubscribe failure");
            callbacks.delete(callback);
          };
        }
      };
      const mount = createMcpMount(() => new Server(
        { name: "retention-test", version: "1" },
        { capabilities: { tools: { listChanged: true } } }
      ), { handler: { bus } });
      const OriginalStream = globalThis.ReadableStream;
      globalThis.ReadableStream = class extends OriginalStream {
        constructor(source = {}, strategy) {
          super({ ...source, start(controller) {
            controllers.push(new WeakRef(controller));
            return source.start?.call(source, controller);
          } }, strategy);
        }
      };
      try {
        const response = await mount.fetch(new Request("http://retention.invalid/mcp", {
          method: "POST", headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            "mcp-protocol-version": "2026-07-28",
            "mcp-method": "subscriptions/listen"
          }, body: JSON.stringify({ jsonrpc: "2.0", id: 1,
            method: "subscriptions/listen", params: {
              notifications: { toolsListChanged: true }, _meta: {
                "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                "io.modelcontextprotocol/clientInfo": { name: "retention-test", version: "1" },
                "io.modelcontextprotocol/clientCapabilities": {}
              }
            }
          })
        }));
        assert.equal(response.status, 200);
        const reader = response.body.getReader();
        assert.equal((await reader.read()).done, false);
        assert.ok(target?.deref());
        await reader.cancel();
        await mount.handler.close();
        assert.equal(callbacks.size, fail ? 1 : 0);
        return { callbacks, target };
      } finally {
        globalThis.ReadableStream = OriginalStream;
        await mount.handler.close();
      }
    }
    for (const entry of ["index.js", "index-node.js"]) {
      const { createMcpMount } = await import(new URL(entry, dist));
      const healthy = await probe(createMcpMount, false);
      const failed = await probe(createMcpMount, true);
      for (let count = 0; count < 5; count++) { await tick(); globalThis.gc(); }
      results.push({
        entry,
        healthyRetained: healthy.target.deref() !== undefined,
        failedRetained: failed.target.deref() !== undefined,
        retainedBackendCallbacks: failed.callbacks.size
      });
      failed.callbacks.clear();
    }
    console.log("RETENTION_PROBE " + JSON.stringify(results));
    `,
  ]);
  const line = stdout
    .split("\n")
    .find((value) => value.startsWith("RETENTION_PROBE "));
  expect(line).toBeDefined();
  expect(JSON.parse(line!.slice("RETENTION_PROBE ".length))).toEqual(
    ["index.js", "index-node.js"].map((entry) => ({
      entry,
      healthyRetained: false,
      failedRetained: false,
      retainedBackendCallbacks: 1,
    }))
  );
});
