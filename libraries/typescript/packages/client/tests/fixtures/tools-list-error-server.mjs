import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

// Raw stdio MCP fixture for exercising tools/list failures deterministically.
// Usage: node tools-list-error-server.mjs <method-not-found|internal-error|close> [pidFile]
const mode = process.argv[2] ?? "internal-error";
const pidFile = process.argv[3];
if (pidFile) {
  appendFileSync(pidFile, `${process.pid}\n`);
}

const input = createInterface({ input: process.stdin });
input.on("close", () => process.exit(0));
input.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method === "initialize") {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: request.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: "tools-list-error-fixture", version: "1.0.0" },
        },
      }) + "\n"
    );
    return;
  }
  if (request.method === "tools/list") {
    if (mode === "close") {
      // Drop the transport while the request is in flight.
      process.exit(1);
    }
    const error =
      mode === "method-not-found"
        ? { code: -32601, message: "Method not found" }
        : { code: -32603, message: "storage backend unavailable" };
    process.stdout.write(
      JSON.stringify({ jsonrpc: "2.0", id: request.id, error }) + "\n"
    );
    return;
  }
  if (request.id !== undefined) {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32601, message: "Method not found" },
      }) + "\n"
    );
  }
});
