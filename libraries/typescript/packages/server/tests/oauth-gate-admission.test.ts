import type {
  AuthInfo,
  JSONRPCMessage,
  OAuthTokenVerifier,
} from "@modelcontextprotocol/server";
import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";

import { getRequestBag } from "../src/fetch-app.js";
import { createOAuthGate } from "../src/oauth/gate.js";
import type { OAuthAdmissionHook } from "../src/oauth/provider.js";

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
  ) => ReturnType<OAuthAdmissionHook>;
  verifier?: OAuthTokenVerifier;
}) {
  return createOAuthGate({
    verifier: options.verifier ?? {
      verifyAccessToken: async () => {
        throw new Error(
          "The built-in verifier should not run for admitted requests"
        );
      },
    },
    resourceMetadataUrl:
      "https://api.example.test/.well-known/oauth-protected-resource",
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
    const admit = vi.fn(
      async (_request: Request, messages: JSONRPCMessage[]) => {
        expect(messages).toEqual([payload]);
        return { bearer: "adapter-token", authInfo: authInfo() };
      }
    );
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

    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toContain(
      'error="insufficient_scope"'
    );
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    [
      "invalid admission AuthInfo",
      "Invalid adapter authentication information",
    ],
    ["identity-mapping failure", "Token identity mapping failed"],
    [
      "incorrect resource binding",
      "Token resource does not match the protected resource",
    ],
  ])("%s uses the OAuth invalid-token response", async (_name, message) => {
    const admit = vi.fn(async () => {
      throw new OAuthError(OAuthErrorCode.InvalidToken, message);
    });
    const next = vi.fn(async () => new Response("should not run"));

    const response = await makeGate({ admit })(makeRequest(), next);

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      'error="invalid_token"'
    );
    expect(response.headers.get("www-authenticate")).toContain(
      `error_description="${message}"`
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("keeps admission insufficient-scope failures as scope challenges", async () => {
    const admit = vi.fn(async () => {
      throw new OAuthError(
        OAuthErrorCode.InsufficientScope,
        "The adapter identity lacks the required scope"
      );
    });
    const response = await makeGate({ admit })(
      makeRequest(),
      async () => new Response("unexpected")
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toContain(
      'error="insufficient_scope"'
    );
    expect(response.headers.get("www-authenticate")).toContain(
      'error_description="The adapter identity lacks the required scope"'
    );
  });

  it("does not classify unexpected admission failures as invalid credentials", async () => {
    const failure = new Error("adapter service unavailable");
    const admit = vi.fn(async () => {
      throw failure;
    });

    const response = await makeGate({ admit })(
      makeRequest(),
      async () => new Response("unexpected")
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("www-authenticate")).toBeNull();
  });

  it("defers to bearer verification for standard credentials", async () => {
    const verifyAccessToken = vi.fn(async () => authInfo());
    const verifier: OAuthTokenVerifier = { verifyAccessToken };
    const admit = vi.fn(async () => ({ type: "defer" as const }));
    const incoming = makeRequest();
    const authenticated = new Request(incoming, {
      headers: { authorization: "Bearer standard-token" },
    });
    const next = vi.fn(async () => new Response("accepted"));

    const response = await makeGate({ admit, verifier })(authenticated, next);

    expect(response.status).toBe(200);
    expect(verifyAccessToken).toHaveBeenCalledWith("standard-token");
    expect(getRequestBag(authenticated).authInfo).toMatchObject({
      clientId: "adapter-client",
    });
  });

  it("defers anonymous requests without calling the built-in verifier", async () => {
    const verifyAccessToken = vi.fn(async () => authInfo());
    const verifier: OAuthTokenVerifier = { verifyAccessToken };
    const admit = vi.fn(async () => ({ type: "defer" as const }));
    const anonymousGate = createOAuthGate({
      verifier,
      resourceMetadataUrl:
        "https://api.example.test/.well-known/oauth-protected-resource",
      baselineScopes: ["mcp"],
      mixedAuth: true,
      toolSchemes: () => [{ type: "noauth" }],
      openResourceUris: [],
      admit,
    });
    const next = vi.fn(async () => new Response("anonymous"));
    const incoming = makeRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "public" },
    });

    const response = await anonymousGate(incoming, next);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("anonymous");
    expect(verifyAccessToken).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });
});
