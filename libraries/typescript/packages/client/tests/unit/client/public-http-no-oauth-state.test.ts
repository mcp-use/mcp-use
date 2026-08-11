import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MCPClient } from "../../../src/core/node.js";

describe("public HTTP OAuth state", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("connects locally without creating the configured OAuth directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "mcp-use-public-http-"));
    const oauthBase = join(root, "oauth-must-stay-absent");
    cleanups.push(() => rm(root, { recursive: true, force: true }));

    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const message = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        id?: number;
        method?: string;
      };
      if (message.method === "notifications/initialized") {
        response.writeHead(202).end();
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result:
            message.method === "initialize"
              ? {
                  protocolVersion: "2025-11-25",
                  capabilities: {},
                  serverInfo: { name: "public-fixture", version: "1.0.0" },
                }
              : {},
        })
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    cleanups.push(
      () =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        )
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Fixture did not bind to a TCP port");
    }

    const client = new MCPClient({
      mcpServers: {
        public: {
          url: `http://127.0.0.1:${address.port}/mcp`,
          oauth: { baseDir: oauthBase },
          protocolNegotiation: "legacy",
        },
      },
    });

    await client.connect("public");

    expect(existsSync(oauthBase)).toBe(false);
    await client.closeAllSessions();
  });
});
