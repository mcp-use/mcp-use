import {
  AuthorizationServerMismatchError,
  ClientCredentialsProvider,
  fetchToken,
  SdkError,
  SdkErrorCode,
} from "@modelcontextprotocol/client";
import { describe, expect, it, vi } from "vitest";
import { HttpConnector } from "../../../src/transport/http.js";

describe("official SDK upgrade compatibility", () => {
  it("refuses an issuer mismatch before sending client credentials", async () => {
    const provider = new ClientCredentialsProvider({
      clientId: "test-client",
      clientSecret: "test-secret",
      expectedIssuer: "https://issuer.example.com",
    });
    const fetchFn = vi.fn<typeof fetch>();

    await expect(
      fetchToken(provider, "https://other.example.com", {
        metadata: {
          issuer: "https://other.example.com",
          authorization_endpoint: "https://other.example.com/authorize",
          token_endpoint: "https://other.example.com/token",
          jwks_uri: "https://other.example.com/jwks",
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
        },
        fetchFn,
      })
    ).rejects.toBeInstanceOf(AuthorizationServerMismatchError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("preserves the standard SDK error cause", () => {
    const cause = new TypeError("fetch failed");
    const error = new SdkError(
      SdkErrorCode.EraNegotiationFailed,
      "probe failed",
      undefined,
      { cause }
    );
    expect(error.cause).toBe(cause);
  });

  it("rejects a cross-origin redirect and keeps the connection usable", async () => {
    let redirect = true;
    const requestedUrls: string[] = [];
    const fetchMock: typeof fetch = async (input, init) => {
      requestedUrls.push(String(input));
      if (init?.method === "GET") return new Response(null, { status: 405 });
      if (init?.method === "DELETE") return new Response(null, { status: 200 });
      const request = JSON.parse(init!.body as string);
      if (request.id === undefined) return new Response(null, { status: 202 });
      if (request.method === "initialize") {
        return Response.json({
          jsonrpc: "2.0",
          id: request.id,
          result: {
            protocolVersion: "2025-11-25",
            capabilities: { tools: {} },
            serverInfo: { name: "redirect-fixture", version: "1.0.0" },
          },
        });
      }
      if (redirect) {
        redirect = false;
        return new Response(null, {
          status: 307,
          headers: { location: "https://other.example.com/mcp" },
        });
      }
      return Response.json({
        jsonrpc: "2.0",
        id: request.id,
        result: { tools: [] },
      });
    };
    const connector = new HttpConnector("https://mcp.example.com/mcp", {
      protocolNegotiation: "legacy",
      fetch: fetchMock,
    });
    try {
      await connector.connect();
      await expect(connector.listTools()).rejects.toThrow(/redirect/i);
      await expect(connector.listTools()).resolves.toEqual([]);
      expect(
        requestedUrls.every((url) => url.startsWith("https://mcp.example.com/"))
      ).toBe(true);
    } finally {
      await connector.disconnect();
    }
  });

  it.each(["legacy", "modern"] as const)(
    "lists all %s tools when successive pages share a cursor",
    async (era) => {
      let page = 0;
      const modern = era === "modern";
      const complete = (result: object) =>
        modern ? { resultType: "complete", ...result } : result;
      const fetchMock: typeof fetch = async (_input, init) => {
        if (init?.method === "GET") return new Response(null, { status: 405 });
        if (init?.method === "DELETE")
          return new Response(null, { status: 200 });
        const request = JSON.parse(init!.body as string);
        if (request.id === undefined)
          return new Response(null, { status: 202 });
        const respond = (result: object) =>
          Response.json({ jsonrpc: "2.0", id: request.id, result });
        if (request.method === "initialize") {
          return respond({
            protocolVersion: "2025-11-25",
            capabilities: { tools: {} },
            serverInfo: { name: "pagination-fixture", version: "1.0.0" },
          });
        }
        if (request.method === "server/discover") {
          return respond(
            complete({
              supportedVersions: ["2026-07-28"],
              capabilities: { tools: {} },
            })
          );
        }
        if (request.method === "tools/list") {
          page += 1;
          return respond(
            complete({
              ...(modern ? { ttlMs: 0, cacheScope: "private" } : {}),
              tools: [
                {
                  name: `tool-${page}`,
                  inputSchema: { type: "object", properties: {} },
                },
              ],
              ...(page < 3 ? { nextCursor: "same-cursor" } : {}),
            })
          );
        }
        throw new Error(`Unexpected method: ${request.method}`);
      };
      const connector = new HttpConnector("https://mcp.example.com/mcp", {
        protocolNegotiation: modern ? "auto" : "legacy",
        fetch: fetchMock,
      });
      try {
        await connector.connect();
        expect((await connector.listTools()).map((tool) => tool.name)).toEqual([
          "tool-1",
          "tool-2",
          "tool-3",
        ]);
        expect(page).toBe(3);
      } finally {
        await connector.disconnect();
      }
    }
  );
});
