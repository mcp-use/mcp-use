import { createInterface } from "node:readline";

let initialize;
const hold = setInterval(() => {}, 1000);
process.on("SIGUSR2", () => clearInterval(hold));
if (process.argv.includes("--ignore-term")) {
  process.on("SIGTERM", () => process.stderr.write("TERM_IGNORED\n"));
}
const lines = createInterface({ input: process.stdin });
lines.on("close", () => process.stderr.write("STDIN_CLOSED\n"));
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    initialize = message;
    process.stderr.write("READY\n");
  } else if (message.method === "probe/release") {
    const response = message.params.fail
      ? { error: { code: -32603, message: "injected handshake failure" } }
      : {
          result: {
            protocolVersion: initialize.params.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: "exit-barrier-probe", version: "1" },
          },
        };
    process.stdout.write(
      JSON.stringify({ jsonrpc: "2.0", id: initialize.id, ...response }) + "\n"
    );
  } else if (message.method === "tools/list") {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: { tools: [] },
      }) + "\n"
    );
  }
});
