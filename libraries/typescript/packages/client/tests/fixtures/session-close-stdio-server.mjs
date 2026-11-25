import { appendFileSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";

const [spawnLog, mode] = process.argv.slice(2);
appendFileSync(spawnLog, `${process.pid}\n`);
const firstStart =
  readFileSync(spawnLog, "utf8").trim().split("\n").length === 1;
setTimeout(() => process.exit(1), 10_000).unref();

const input = createInterface({ input: process.stdin });
input.on("close", () => process.exit(0));
input.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;

  let result;
  let error;
  switch (request.method) {
    case "initialize":
      if (firstStart && mode === "exit-initialize-once") process.exit(0);
      if (firstStart && mode === "fail-initialize-once") {
        error = { code: -32603, message: "Initialization failed" };
        break;
      }
      result = {
        protocolVersion: request.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "session-close-fixture", version: "1.0.0" },
      };
      break;
    case "tools/list":
      result = {
        tools: ["ping", "exit"].map((name) => ({
          name,
          inputSchema: { type: "object", properties: {} },
        })),
      };
      break;
    case "tools/call":
      if (request.params.name === "exit") process.exit(0);
      result = { content: [{ type: "text", text: String(process.pid) }] };
      break;
    default:
      error = { code: -32601, message: "Method not found" };
  }
  process.stdout.write(
    JSON.stringify({ jsonrpc: "2.0", id: request.id, result, error }) + "\n"
  );
});
