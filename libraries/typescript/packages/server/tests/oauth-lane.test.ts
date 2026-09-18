import { afterEach, describe, expect, it, vi } from "vitest";

import { MCPServer } from "../src/index.js";
import { OAuthError, OAuthErrorCode } from "../src/oauth/index.js";
import {
  memoryLaneConnectionStore,
  oauthLaneProvider,
  type LaneOAuthUser,
} from "../src/oauth/lane.js";

const resource = "https://lane.example.test/mcp";
const issuer = "https://auth.getonlane.com/auth/mcp";
const servers: MCPServer<LaneOAuthUser>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function fixture() {
  const connections = memoryLaneConnectionStore();
  const exchange = vi.fn(async () => ({
    accessToken: "exchanged-token",
    scopes: ["email"],
    expiresIn: 3600,
  }));
  const server = new MCPServer({
    name: "lane-test",
    version: "1.0.0",
    oauth: oauthLaneProvider({
      resource,
      connections,
      exchanger: { exchange },
      createTokenVerifier: (audience) => ({
        async verifyAccessToken(token) {
          if (token === "invalid") {
            throw new OAuthError(OAuthErrorCode.InvalidToken, "invalid token");
          }
          const [sub = "user", clientId = "client", jti = "first"] =
            token.split(":");
          return {
            token,
            clientId,
            scopes: [],
            expiresAt: Date.now() / 1000 + 3600,
            resource: audience,
            extra: { payload: { sub, client_id: clientId, jti, iss: issuer } },
          };
        },
      }),
    }),
  });
  const run = vi.fn(async () => ({
    content: [{ type: "text" as const, text: "ok" }],
  }));
  server.tool({ name: "browse" }, run);
  server.tool({ name: "checkout" }, run);
  servers.push(server);
  return { server, connections, exchange, run };
}

function rpc(
  server: MCPServer<LaneOAuthUser>,
  method: string,
  params?: unknown,
  token?: string
) {
  return post(
    server,
    {
      jsonrpc: "2.0",
      ...(method === "notifications/initialized" ? {} : { id: 1 }),
      method,
      ...(params === undefined ? {} : { params }),
    },
    token
  );
}

function post(server: MCPServer<LaneOAuthUser>, body: unknown, token?: string) {
  return server.fetch(
    new Request(resource, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-11-25",
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(body),
    })
  );
}

async function result(response: Response) {
  expect(response.status).toBe(200);
  const body = await response.text();
  return JSON.parse(
    response.headers.get("content-type")?.includes("text/event-stream")
      ? body
          .split("\n")
          .find((line) => line.startsWith("data: "))!
          .slice(6)
      : body
  ).result;
}

async function call(
  server: MCPServer<LaneOAuthUser>,
  name: string,
  token?: string
) {
  return rpc(server, "tools/call", { name, arguments: {} }, token);
}

describe("Lane anonymous discovery", () => {
  it("allows initialize, the initialized notification, and the full tools list", async () => {
    const { server, run, exchange } = fixture();
    const initialized = await result(
      await rpc(server, "initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "anonymous-prober", version: "1.0.0" },
      })
    );
    expect(initialized.serverInfo.name).toBe("lane-test");
    expect(initialized.instructions).toContain("lane_register_session");
    expect((await rpc(server, "notifications/initialized")).status).toBe(202);
    const listed = await result(await rpc(server, "tools/list"));
    expect(
      listed.tools.map((tool: { name: string }) => tool.name).sort()
    ).toEqual([
      "browse",
      "checkout",
      "lane_register_session",
      "lane_session_info",
    ]);
    expect(run).not.toHaveBeenCalled();
    expect(exchange).not.toHaveBeenCalled();
  });

  it("401s every anonymous tool call, including reserved tools, with OAuth metadata", async () => {
    const { server, run, exchange } = fixture();
    for (const tool of [
      "browse",
      "checkout",
      "lane_register_session",
      "lane_session_info",
      "unknown",
    ]) {
      const response = await call(server, tool);
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain(
        'resource_metadata="https://lane.example.test/.well-known/oauth-protected-resource/mcp"'
      );
    }
    expect(run).not.toHaveBeenCalled();
    expect(exchange).not.toHaveBeenCalled();
  });

  it("does not exempt other methods, batches, or invalid supplied credentials", async () => {
    const { server, run } = fixture();
    for (const method of [
      "resources/read",
      "resources/list",
      "prompts/list",
      "ping",
    ]) {
      expect((await rpc(server, method)).status).toBe(401);
    }
    expect(
      (
        await post(server, [
          { jsonrpc: "2.0", id: 1, method: "tools/list" },
          {
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: { name: "browse" },
          },
        ])
      ).status
    ).toBe(401);
    for (const method of [
      "initialize",
      "tools/list",
      "notifications/initialized",
    ]) {
      expect((await rpc(server, method, undefined, "invalid")).status).toBe(
        401
      );
    }
    expect((await server.fetch(new Request(resource))).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("Lane connection identity", () => {
  it("reuses a connection after token refresh and retains registration jti", async () => {
    const { server, connections, exchange, run } = fixture();
    expect(
      await result(await call(server, "browse", "user:client:first"))
    ).toMatchObject({ isError: true });
    expect(
      await result(
        await call(server, "lane_register_session", "user:client:first")
      )
    ).not.toHaveProperty("isError");
    expect(
      await connections.get({ sub: "user", clientId: "client" })
    ).toMatchObject({ jti: "first", scopes: ["email"] });
    expect(
      await result(await call(server, "browse", "user:client:refreshed"))
    ).not.toHaveProperty("isError");
    const report = await result(
      await call(server, "lane_session_info", "user:client:refreshed")
    );
    expect(JSON.parse(report.content[0].text)).toMatchObject({
      connected: true,
      identity: { credential_id: "refreshed" },
    });
    expect(
      (await connections.get({ sub: "user", clientId: "client" }))?.jti
    ).toBe("first");
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(connections.size()).toBe(1);
  });

  it("isolates different subjects and clients even when they share a jti", async () => {
    const { server, run } = fixture();
    await result(
      await call(server, "lane_register_session", "user:client:same")
    );
    for (const token of ["other:client:same", "user:other:same"]) {
      expect(await result(await call(server, "browse", token))).toMatchObject({
        isError: true,
      });
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("requires registration again after connection expiry or deletion", async () => {
    const { server, connections, run } = fixture();
    const key = { sub: "user", clientId: "client" };
    await connections.put(key, {
      jti: "first",
      scopes: [],
      expiresAt: Date.now() / 1000 - 1,
    });
    expect(
      await result(await call(server, "browse", "user:client:refreshed"))
    ).toMatchObject({ isError: true });
    await result(
      await call(server, "lane_register_session", "user:client:refreshed")
    );
    await connections.delete!(key);
    expect(
      await result(await call(server, "browse", "user:client:next"))
    ).toMatchObject({ isError: true });
    expect(run).not.toHaveBeenCalled();
  });

  it("uses unambiguous compound keys", async () => {
    const store = memoryLaneConnectionStore();
    await store.put(
      { sub: "a b", clientId: "c" },
      { jti: "first", scopes: [] }
    );
    expect(await store.get({ sub: "a", clientId: "b c" })).toBeNull();
  });
});
