// A deliberately non-conformant "Events" server: it advertises the Events
// capability and answers every request with an empty result, so the
// conformance catalog's MUST rows fail. Prints `READY <port>`.
import { createServer } from "node:http";

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let message;
    try {
      message = JSON.parse(body);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (message.id === undefined) {
      res.writeHead(202).end();
      return;
    }
    const result =
      message.method === "initialize"
        ? {
            protocolVersion: "2025-11-25",
            capabilities: { events: {} },
            serverInfo: { name: "non-conformant", version: "0.0.0" },
          }
        : {};
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  });
});

server.listen(Number(process.env.PORT ?? 0), "127.0.0.1", () => {
  process.stdout.write(`READY ${server.address().port}\n`);
});
