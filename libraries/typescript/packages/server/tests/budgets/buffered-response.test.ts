import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const exec = promisify(execFile);

it("shares buffered response identity across published server and bridge bundles", async () => {
  // A child process imports emitted artifacts directly, without Vitest's source
  // transforms. The published bridge is also used by the Vite integration.
  const dist = new URL("../../dist/", import.meta.url).href;
  const { stdout } = await exec(process.execPath, [
    "--input-type=module",
    "-e",
    `
    const dist = ${JSON.stringify(dist)};
    const { toNodeHandler } = await import(new URL("node-bridge.js", dist));
    await import(new URL("vite/index.js", dist));
    const results = [];
    for (const entry of ["index.js", "index-node.js"]) {
      const { MCPServer } = await import(new URL(entry, dist));
      const server = new MCPServer({ name: "buffer-probe", version: "1" });
      server.tool({ name: "ping" }, async () => ({content: [{type: "text", text: "pong"}]}));
      try {
        for (const mode of ["original", "headers", "replacement", "unmarked"]) {
          const writes = [];
          let end;
          const bridge = toNodeHandler({fetch: async request => {
            const response = await server.fetch(request);
            if (mode === "headers") return new Response(response.body, {headers: response.headers});
            if (mode === "replacement") return new Response(await response.text(), {headers: response.headers});
            if (mode === "unmarked") { await response.body?.cancel(); return Response.json({ok: true}); }
            return response;
          }});
          await bridge({
            method: "POST", url: "/mcp", headers: {
              host: "localhost", "content-type": "application/json",
              accept: "application/json, text/event-stream",
              "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/call", "mcp-name": "ping"
            }, async *[Symbol.asyncIterator]() {}
          }, {
            writeHead() {}, on() {},
            write(bytes) { writes.push(bytes); return true; },
            end(bytes) { end = bytes; }
          }, {jsonrpc: "2.0", id: 1, method: "tools/call", params: {
            name: "ping", arguments: {}, _meta: {
              "io.modelcontextprotocol/protocolVersion": "2026-07-28",
              "io.modelcontextprotocol/clientInfo": {name: "probe", version: "1"},
              "io.modelcontextprotocol/clientCapabilities": {}
            }
          }});
          results.push({entry, mode, writes: writes.length, bufferedEnd: end !== undefined});
        }
      } finally { await server.close(); }
    }
    console.log("BUFFER_PROBE " + JSON.stringify(results));
    `,
  ]);
  const line = stdout
    .split("\n")
    .find((value) => value.startsWith("BUFFER_PROBE "));
  expect(line).toBeDefined();
  expect(JSON.parse(line!.slice("BUFFER_PROBE ".length))).toEqual(
    ["index.js", "index-node.js"].flatMap((entry) =>
      ["original", "headers", "replacement", "unmarked"].map((mode) => ({
        entry,
        mode,
        writes: mode === "original" || mode === "headers" ? 0 : 1,
        bufferedEnd: mode === "original" || mode === "headers",
      }))
    )
  );
});
