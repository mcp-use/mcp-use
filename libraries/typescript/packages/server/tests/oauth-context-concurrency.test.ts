import { serve, type ServerType } from "@hono/node-server";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import {
  McpServer,
  type AuthInfo,
  type ServerContext,
} from "@modelcontextprotocol/server";
import { Hono, type Env } from "hono";
import { afterEach, describe, expect, it } from "vitest";

import { toAuthenticatedRequestContext } from "../src/context.js";
import { mountMcp } from "../src/mount-mcp.js";

interface TestUser {
  id: string;
}

interface CallbackObservation {
  factoryInstance: number;
  rawAuthInfo: AuthInfo | undefined;
  user: TestUser;
  payload: Record<string, unknown>;
  accessToken: string;
  scopes: string[];
  permissions: string[];
  clientId?: string | undefined;
  expiresAt: number;
  resource?: URL | undefined;
  request?: Request | undefined;
  signal: AbortSignal;
}

const httpServers: ServerType[] = [];

afterEach(async () => {
  await Promise.all(
    httpServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        })
    )
  );
});

function createAuthInfo(id: string): AuthInfo {
  return {
    token: `token-${id}`,
    clientId: `client-${id}`,
    scopes: [`read:${id}`],
    expiresAt: 4_102_444_800,
    resource: new URL(`https://api.example.test/mcp/${id}`),
    extra: {
      user: { id },
      payload: { subject: id, issuer: "https://issuer.example.test" },
      permissions: [`resource:${id}:read`],
    },
  };
}

async function listen<E extends Env>(app: Hono<E>): Promise<string> {
  const server = await new Promise<ServerType>((resolve) => {
    const started = serve(
      { fetch: app.fetch, port: 0, hostname: "127.0.0.1" },
      () => resolve(started)
    );
  });
  httpServers.push(server);
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Test server did not expose a TCP address");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function connectClient(url: string, token?: string): Promise<Client> {
  const client = new Client(
    { name: "oauth-context-test", version: "0.0.1" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } }
  );
  const transport = new StreamableHTTPClientTransport(new URL("/mcp", url), {
    ...(token !== undefined && {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  });
  await client.connect(transport);
  return client;
}

function observeContext(
  factoryInstance: number,
  context: ServerContext
): CallbackObservation {
  const callbackContext = toAuthenticatedRequestContext<TestUser>(context);
  const observation: CallbackObservation = {
    factoryInstance,
    rawAuthInfo: context.http?.authInfo,
    user: callbackContext.auth.user,
    payload: callbackContext.auth.payload,
    accessToken: callbackContext.auth.accessToken,
    scopes: [...callbackContext.auth.scopes],
    permissions: [...callbackContext.auth.permissions],
    clientId: callbackContext.auth.clientId,
    expiresAt: callbackContext.auth.expiresAt,
    resource: callbackContext.auth.resource,
    request: callbackContext.request,
    signal: callbackContext.signal,
  };

  // These must be callback-local copies, not references to wire AuthInfo.
  callbackContext.auth.scopes.push("callback-only-scope");
  callbackContext.auth.permissions.push("callback-only-permission");
  return observation;
}

describe("mountMcp OAuth request context", () => {
  it("forwards Hono AuthInfo exactly, projects it in tool/resource callbacks, and isolates concurrent requests", async () => {
    const alice = createAuthInfo("alice");
    const bob = createAuthInfo("bob");
    const authByToken = new Map([
      [alice.token, alice],
      [bob.token, bob],
    ]);
    const forwardedToFactories: Array<AuthInfo | undefined> = [];
    const observations: CallbackObservation[] = [];
    let factoryInstances = 0;

    const app = new Hono<{ Variables: { authInfo?: AuthInfo } }>();
    app.use("/mcp", async (context, next) => {
      const token = context.req
        .header("authorization")
        ?.replace(/^Bearer /, "");
      const authInfo = token === undefined ? undefined : authByToken.get(token);
      if (authInfo !== undefined) {
        // This intentionally models custom host middleware. No request-global
        // state participates in carrying identity to mountMcp.
        context.set("authInfo", authInfo);
      }
      await next();
    });

    mountMcp(
      app,
      ({ authInfo }) => {
        const factoryInstance = ++factoryInstances;
        forwardedToFactories.push(authInfo);
        const server = new McpServer({
          name: "oauth-context-test",
          version: "0.0.1",
        });
        server.registerTool("whoami", {}, async (context) => {
          const observation = observeContext(factoryInstance, context);
          observations.push(observation);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  user: observation.user.id,
                  token: observation.accessToken,
                  factoryInstance,
                }),
              },
            ],
          };
        });
        server.registerResource(
          "identity",
          "test://identity",
          {},
          async (_uri, context) => {
            const observation = observeContext(factoryInstance, context);
            observations.push(observation);
            return {
              contents: [
                {
                  uri: "test://identity",
                  text: JSON.stringify({
                    user: observation.user.id,
                    token: observation.accessToken,
                    factoryInstance,
                  }),
                },
              ],
            };
          }
        );
        return server;
      },
      { authInfo: (context) => context.get("authInfo") }
    );

    const url = await listen(app);
    const [aliceClient, bobClient] = await Promise.all([
      connectClient(url, alice.token),
      connectClient(url, bob.token),
    ]);
    try {
      const [aliceResult, bobResult, aliceResource] = await Promise.all([
        aliceClient.callTool({ name: "whoami" }),
        bobClient.callTool({ name: "whoami" }),
        aliceClient.readResource({ uri: "test://identity" }),
      ]);

      const toolResponses = [aliceResult, bobResult].map((result) =>
        JSON.parse((result.content[0] as { text: string }).text)
      );
      expect(toolResponses).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ user: "alice", token: alice.token }),
          expect.objectContaining({ user: "bob", token: bob.token }),
        ])
      );
      const resourceContent = aliceResource.contents[0];
      expect(resourceContent).toBeDefined();
      if (resourceContent === undefined || !("text" in resourceContent)) {
        throw new Error("Expected text resource content");
      }
      expect(JSON.parse(resourceContent.text)).toMatchObject({
        user: "alice",
        token: alice.token,
      });

      // The same object placed in Hono variables is supplied to both the SDK
      // factory and the live SDK callback context; it is never reconstructed.
      expect(forwardedToFactories).toContain(alice);
      expect(forwardedToFactories).toContain(bob);
      expect(observations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            rawAuthInfo: alice,
            user: { id: "alice" },
          }),
          expect.objectContaining({ rawAuthInfo: bob, user: { id: "bob" } }),
        ])
      );

      for (const observation of observations) {
        const expected = observation.user.id === "alice" ? alice : bob;
        expect(observation.rawAuthInfo).toBe(expected);
        expect(observation.payload).toEqual(expected.extra!.payload);
        expect(observation.accessToken).toBe(expected.token);
        expect(observation.scopes).toEqual(expected.scopes);
        expect(observation.permissions).toEqual(expected.extra!.permissions);
        expect(observation.clientId).toBe(expected.clientId);
        expect(observation.expiresAt).toBe(expected.expiresAt);
        expect(observation.resource).toBe(expected.resource);
        expect(observation.request).toBeInstanceOf(Request);
        expect(observation.signal).toBeInstanceOf(AbortSignal);
      }
      expect(alice.scopes).toEqual(["read:alice"]);
      expect(alice.extra!.permissions).toEqual(["resource:alice:read"]);
      expect(bob.scopes).toEqual(["read:bob"]);
      expect(bob.extra!.permissions).toEqual(["resource:bob:read"]);

      const callbackFactoryInstances = new Set(
        observations.map((observation) => observation.factoryInstance)
      );
      expect(callbackFactoryInstances.size).toBe(observations.length);
    } finally {
      await Promise.all([aliceClient.close(), bobClient.close()]);
    }
  });

  it("preserves unauthenticated mount behavior when no authInfo resolver is supplied", async () => {
    const callbackAuthInfo: Array<AuthInfo | undefined> = [];
    const app = new Hono();
    mountMcp(app, ({ authInfo }) => {
      callbackAuthInfo.push(authInfo);
      const server = new McpServer({
        name: "unauthenticated-context-test",
        version: "0.0.1",
      });
      server.registerTool("anonymous", {}, async (context) => ({
        content: [
          {
            type: "text",
            text:
              context.http?.authInfo === undefined
                ? "anonymous"
                : "unexpected-auth",
          },
        ],
      }));
      return server;
    });

    const client = await connectClient(await listen(app));
    try {
      const result = await client.callTool({ name: "anonymous" });
      expect(result.content).toEqual([{ type: "text", text: "anonymous" }]);
      expect(callbackAuthInfo).toEqual(expect.arrayContaining([undefined]));
    } finally {
      await client.close();
    }
  });

  it("surfaces the mapped AuthInfo invariant from a live callback", async () => {
    const incompleteAuthInfo: AuthInfo = {
      token: "unmapped-token",
      clientId: "unmapped-client",
      scopes: [],
      expiresAt: 4_102_444_800,
    };
    let callbackError: unknown;
    const app = new Hono<{ Variables: { authInfo: AuthInfo } }>();
    app.use("/mcp", async (context, next) => {
      context.set("authInfo", incompleteAuthInfo);
      await next();
    });
    mountMcp(
      app,
      () => {
        const server = new McpServer({
          name: "missing-mapped-auth-info",
          version: "0.0.1",
        });
        server.registerTool("must-have-mapped-auth", {}, async (context) => {
          try {
            toAuthenticatedRequestContext<TestUser>(context);
          } catch (error) {
            callbackError = error;
            throw error;
          }
          return { content: [] };
        });
        return server;
      },
      { authInfo: (context) => context.get("authInfo") }
    );

    const client = await connectClient(await listen(app));
    try {
      const result = await client.callTool({ name: "must-have-mapped-auth" });
      expect(result).toMatchObject({
        isError: true,
        content: [
          {
            type: "text",
            text: "OAuth callback did not receive mapped AuthInfo.extra",
          },
        ],
      });
      expect(callbackError).toEqual(
        expect.objectContaining({
          message: "OAuth callback did not receive mapped AuthInfo.extra",
        })
      );
    } finally {
      await client.close();
    }
  });
});
