import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const [spawnLog, mode] = process.argv.slice(2);
appendFileSync(spawnLog, `${process.pid}\n`);
setTimeout(() => process.exit(1), 10_000).unref();
const input = createInterface({ input: process.stdin });
input.on("close", () => process.exit(0));
input.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  const respond = (result, callback) =>
    process.stdout.write(
      JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n",
      callback
    );
  if (request.method === "initialize") {
    respond({
      protocolVersion: request.params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: "stderr-lifecycle-fixture", version: "1.0.0" },
    });
  } else if (request.method === "tools/list") {
    respond({
      tools: ["first", "second", "ping", "exit"].map((name) => ({
        name,
        inputSchema: { type: "object" },
      })),
    });
  } else if (request.method === "tools/call") {
    const name = request.params.name;
    const result = { content: [{ type: "text", text: String(process.pid) }] };
    if (name === "exit") {
      respond(result, () => process.exit(0));
      return;
    }
    if (name === "ping") {
      respond(result);
      return;
    }
    process.stderr.write(name === "first" ? "FIRST" : "SECOND", () => {
      respond(result, () => {
        if (name === "second" && mode === "natural") process.exit(0);
      });
    });
  }
});
