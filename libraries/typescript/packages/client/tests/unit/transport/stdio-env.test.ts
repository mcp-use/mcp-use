import { afterEach, describe, expect, it } from "vitest";

import { StdioConnector } from "../../../src/transport/stdio.js";

const SECRET_KEY = "MCP_USE_STDIO_ENV_LEAK_PROBE";
const EXPLICIT_KEY = "MCP_USE_STDIO_EXPLICIT_PROBE";
const previousSecret = process.env[SECRET_KEY];

const envProbeServer = String.raw`
const readline = require("node:readline");

const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;

  let result;
  if (request.method === "initialize") {
    const secretState = process.env.${SECRET_KEY} === undefined ? "absent" : "present";
    const explicitState = process.env.${EXPLICIT_KEY} === "configured" ? "present" : "absent";
    result = {
      protocolVersion: request.params.protocolVersion,
      capabilities: {},
      serverInfo: {
        name: "secret-" + secretState + "-explicit-" + explicitState,
        version: "1.0.0"
      }
    };
  } else if (request.method === "tools/list") {
    result = { tools: [] };
  } else {
    return;
  }

  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n");
});
`;

afterEach(() => {
  if (previousSecret === undefined) {
    delete process.env[SECRET_KEY];
  } else {
    process.env[SECRET_KEY] = previousSecret;
  }
});

describe("StdioConnector environment", () => {
  it("passes explicit variables without leaking unrelated parent variables", async () => {
    process.env[SECRET_KEY] = "super-secret";
    const connector = new StdioConnector({
      command: process.execPath,
      args: ["-e", envProbeServer],
      env: { [EXPLICIT_KEY]: "configured" },
    });

    try {
      await connector.connect();
      await connector.initialize();

      expect(connector.serverInfo?.name).toBe("secret-absent-explicit-present");
    } finally {
      await connector.disconnect();
    }
  });
});
