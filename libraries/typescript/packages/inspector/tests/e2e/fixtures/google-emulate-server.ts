/**
 * Uses `oauthProxy` mode rather than `oauthCustomProvider` because emulate's
 * Google issuer exposes `/.well-known/openid-configuration` but not the
 * `oauth-authorization-server` path that DCR-direct mode proxies through.
 * Proxy mode lets the MCP server synthesize metadata pointing at local
 * /authorize, /token, /register endpoints that forward upstream.
 *
 * emulate Google issues opaque access tokens (`google_<rand>`), not JWTs —
 * `verifyToken` calls /oauth2/v2/userinfo with the Bearer token rather than
 * decoding/verifying a signature.
 */

import { createEmulator } from "emulate";
import { MCPServer, oauthProxy, text } from "mcp-use/server";

const GOOGLE_EMULATOR_PORT = 4101;
const MCP_SERVER_PORT = 4201;
const MCP_SERVER_OAUTH_CALLBACK = `http://localhost:${MCP_SERVER_PORT}/oauth/callback`;

const STATIC_CLIENT_ID = "mcp-emulate-test-client.apps.googleusercontent.com";
const STATIC_CLIENT_SECRET = "GOCSPX-mcp-emulate-test-secret";

export const GOOGLE_MOCK_USER = {
  email: "testuser@example.com",
  name: "Test User",
};

export interface GoogleEmulateHandle {
  mcpUrl: string;
  close: () => Promise<void>;
}

export async function startGoogleEmulateFixture(): Promise<GoogleEmulateHandle> {
  const emulator = await createEmulator({
    service: "google",
    port: GOOGLE_EMULATOR_PORT,
    seed: {
      google: {
        users: [
          {
            email: GOOGLE_MOCK_USER.email,
            name: GOOGLE_MOCK_USER.name,
          },
        ],
        oauth_clients: [
          {
            client_id: STATIC_CLIENT_ID,
            client_secret: STATIC_CLIENT_SECRET,
            redirect_uris: [MCP_SERVER_OAUTH_CALLBACK],
          },
        ],
      },
    },
  });

  const emulatorUrl = emulator.url;

  try {
    const mcpServer = new MCPServer({
      name: "GoogleEmulateTestServer",
      version: "1.0.0",
      description: "MCP server backed by the emulate Google OAuth issuer",
      oauth: oauthProxy({
        issuer: emulatorUrl,
        authEndpoint: `${emulatorUrl}/o/oauth2/v2/auth`,
        tokenEndpoint: `${emulatorUrl}/oauth2/token`,
        clientId: STATIC_CLIENT_ID,
        clientSecret: STATIC_CLIENT_SECRET,
        scopes: ["openid", "email", "profile"],
        verifyToken: async (token: string) => {
          const res = await fetch(`${emulatorUrl}/oauth2/v2/userinfo`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!res.ok) {
            throw new Error(
              `userinfo verification failed: ${res.status} ${res.statusText}`
            );
          }
          const payload = (await res.json()) as Record<string, unknown>;
          return { payload };
        },
        getUserInfo: (payload) => ({
          userId: (payload.sub ?? payload.email) as string,
          email: payload.email as string | undefined,
          name: payload.name as string | undefined,
          scopes: [],
        }),
      }),
    });

    mcpServer.tool(
      {
        name: "verify_auth",
        description: "Confirm OAuth authentication succeeded",
      },
      async (_args, ctx) =>
        text(
          `OAuth authentication successful for ${ctx.auth.user.email ?? "unknown"}`
        )
    );

    await mcpServer.listen(MCP_SERVER_PORT);

    return {
      mcpUrl: `http://localhost:${MCP_SERVER_PORT}/mcp`,
      close: async () => {
        await Promise.all([mcpServer.close(), emulator.close()]);
      },
    };
  } catch (err) {
    await emulator.close().catch(() => {});
    throw err;
  }
}
