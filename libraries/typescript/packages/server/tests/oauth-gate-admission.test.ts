import type {
  AuthInfo,
  JSONRPCMessage,
  OAuthTokenVerifier,
} from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";

import { getRequestBag } from "../src/fetch-app.js";
import { createOAuthGate } from "../src/oauth/gate.js";

const resource = new URL("https://api.example.test/mcp");
const payload = {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/list",
  params: {},
};

function authInfo(scopes: string[] = ["mcp"]): AuthInfo {
  return {
    token: "adapter-token",
    clientId: "adapter-client",
    scopes,
    expiresAt: Date.now() / 1000 + 60,
    resource,
  };
}

function makeRequest(body: unknown = payload): Request {
  return new Request(resource, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeGate(options: {
  admit: (
    request: Request,
    messages: JSONRPCMessage[]
  ) => Promise<Response | { bearer: string; authInfo: AuthInfo }>;
  verifier?: OAuthTokenVerifier;
}) {
  return createOAuthGate({
    verifier: options.verifier ?? {
      verifyAccessToken: async () => {
        throw new Error("The built-in verifier should not run for admitted requests");
      },
    },
    resourceMetadataUrl: "https://api.example.test/.well-known/oauth-protected-resource",
    baselineScopes: ["mcp"],
    mixedAuth: false,
    toolSchemes: () => undefined,
    openResourceUris: [],
    admit: options.admit,
  });
}

describe("OAuth admission hook", () => {
  it("passes JSON-RPC messages to the hook and uses its verified identity", async () => {
    const verifyAccessToken = vi.fn(async () => authInfo());
    const verifier: OAuthTokenVerifier = { verifyAccessToken };
    const admit = vi.fn(async (_request: Request, messages: JSONRPCMessage[]) => {
      expect(messages).toEqual([payload]);
      return { bearer: "adapter-token", authInfo: authInfo() };
    });
    const incoming = makeRequest();
    const next = vi.fn(async () => new Response("accepted", { status: 200 }));

    const response = await makeGate({ admit, verifier })(incoming, next);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("accepted");
    expect(admit).toHaveBeenCalledWith(incoming, [payload]);
    expect(verifyAccessToken).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(getRequestBag(incoming).authInfo).toMatchObject({
      token: "adapter-token",
      clientId: "adapter-client",
    });
  });

  it("returns a hook response without invoking the MCP handler", async () => {
    const refusal = new Response("denied", { status: 403 });
    const admit = vi.fn(async () => refusal);
    const next = vi.fn(async () => new Response("should not run"));

    const response = await makeGate({ admit })(makeRequest(), next);

    expect(response).toBe(refusal);
    expect(next).not.toHaveBeenCalled();
  });

  it("still enforces required scopes on the identity returned by the hook", async () => {
    const admit = vi.fn(async () => ({
      bearer: "adapter-token",
      authInfo: authInfo([]),
    }));
    const next = vi.fn(async () => new Response("should not run"));

    const response = await makeGate({ admit })(makeRequest(), next);

    expect(response.status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});
