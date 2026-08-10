import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OAuthClientProvider } from "@modelcontextprotocol/client";
import { HttpConnector } from "../../../src/transport/http.js";

async function readJson(request: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response: ServerResponse, value: unknown, status = 200): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

describe("mixed auth over streamable HTTP", () => {
  const servers: ReturnType<typeof createServer>[] = [];

  afterEach(async () => {
    await Promise.all(
      servers
        .splice(0)
        .map(
          (server) =>
            new Promise<void>((resolve, reject) =>
              server.close((error) => (error ? reject(error) : resolve()))
            )
        )
    );
  });

  it("connects anonymously and starts OAuth only when a protected tool returns 401", async () => {
    let origin = "";
    let releaseMetadata!: () => void;
    const metadataGate = new Promise<void>((resolve) => {
      releaseMetadata = resolve;
    });
    const server = createServer(async (request, response) => {
      const path = new URL(request.url ?? "/", origin).pathname;
      if (path === "/.well-known/oauth-protected-resource/mcp") {
        await metadataGate;
        json(response, {
          resource: `${origin}/mcp`,
          authorization_servers: [origin],
          scopes_supported: ["public", "protected"],
        });
        return;
      }
      if (path === "/.well-known/oauth-authorization-server") {
        json(response, {
          issuer: origin,
          authorization_endpoint: `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code"],
          code_challenge_methods_supported: ["S256"],
        });
        return;
      }
      if (path !== "/mcp" || request.method !== "POST") {
        response.writeHead(404).end();
        return;
      }

      const message = await readJson(request);
      if (message.method === "initialize") {
        json(response, {
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: "2025-11-25",
            capabilities: { tools: {} },
            serverInfo: { name: "mixed-fixture", version: "1.0.0" },
          },
        });
        return;
      }
      if (message.method === "notifications/initialized") {
        response.writeHead(202).end();
        return;
      }
      if (message.method === "tools/list") {
        json(response, {
          jsonrpc: "2.0",
          id: message.id,
          result: {
            tools: [
              {
                name: "protected",
                description: "Requires OAuth",
                inputSchema: { type: "object" },
              },
            ],
          },
        });
        return;
      }
      if (message.method === "tools/call") {
        response.writeHead(401, {
          "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
        });
        response.end("Authentication required");
        return;
      }
      json(response, {
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: "Method not found" },
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Fixture did not bind to a TCP port");
    }
    origin = `http://127.0.0.1:${address.port}`;

    const redirectToAuthorization = vi.fn(async () => {});
    const provider = {
      redirectUrl: `${origin}/callback`,
      clientMetadata: {
        redirect_uris: [`${origin}/callback`],
        client_name: "mixed-auth-test",
      },
      clientInformation: vi.fn(async () => ({ client_id: "test-client" })),
      tokens: vi.fn(async () => undefined),
      saveTokens: vi.fn(async () => {}),
      redirectToAuthorization,
      saveCodeVerifier: vi.fn(async () => {}),
      codeVerifier: vi.fn(async () => "verifier"),
      preventAutoAuth: true,
    } as unknown as OAuthClientProvider;
    const connector = new HttpConnector(`${origin}/mcp`, {
      authProvider: provider,
      protocolNegotiation: "legacy",
    });

    await connector.connect();
    await connector.initialize();
    expect(connector.authorization).toBeUndefined();
    releaseMetadata();
    await connector.discoverAuthorization();

    expect(connector.tools.map((tool) => tool.name)).toEqual(["protected"]);
    expect(connector.authorization).toMatchObject({
      mode: "mixed",
      authenticated: false,
      resource: `${origin}/mcp`,
    });
    expect(redirectToAuthorization).not.toHaveBeenCalled();

    await expect(connector.callTool("protected", {})).rejects.toThrow();
    expect(redirectToAuthorization).toHaveBeenCalledOnce();

    await connector.disconnect();
  });
});
