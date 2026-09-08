import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

// Record every real spawn, including children a broken connector loses track of.
appendFileSync(process.argv[2], `${process.pid}\n`);
// Safety net if the test worker itself crashes before its cleanup hook runs.
setTimeout(() => process.exit(1), 10_000).unref();

const input = createInterface({ input: process.stdin });
input.on("close", () => process.exit(0));
input.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method !== "initialize") return;
  process.stdout.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        protocolVersion: request.params.protocolVersion,
        capabilities: {},
        serverInfo: { name: "lifecycle-fixture", version: "1.0.0" },
      },
    }) + "\n"
  );
});
