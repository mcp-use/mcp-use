import { createInterface } from "node:readline";

// Keep a failed test from leaving a child running indefinitely.
setTimeout(() => process.exit(1), 10_000).unref();
const input = createInterface({ input: process.stdin });
input.on("close", () => process.exit(0));
input.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  let result;
  switch (request.method) {
    case "initialize":
      result = {
        protocolVersion: request.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "local-calculator", version: "1.0.0" },
      };
      break;
    case "tools/list":
      result = {
        tools: [
          {
            name: "square",
            description: "Square a number locally",
            inputSchema: {
              type: "object",
              properties: { value: { type: "number" } },
              required: ["value"],
            },
          },
        ],
      };
      break;
    case "tools/call":
      result = {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              square: request.params.arguments.value ** 2,
              pid: process.pid,
            }),
          },
        ],
      };
      break;
    default:
      result = {};
  }
  process.stdout.write(
    JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n"
  );
});
