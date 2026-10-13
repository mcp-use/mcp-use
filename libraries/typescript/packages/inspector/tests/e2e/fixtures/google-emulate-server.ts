/**
 * Uses a custom OAuth provider backed by the emulate Google issuer.
 * emulate Google issues opaque access tokens (`google_<rand>`), not JWTs —
 * verification calls /oauth2/v2/userinfo with the Bearer token.
 */

import { createEmulator } from "emulate";
import { MCPServer } from "mcp-use";
import { oauthCustomProvider } from "mcp-use/oauth";

const GOOGLE_EMULATOR_PORT = 4101;
const MCP_SERVER_PORT = 4201;
const MCP_SERVER_OAUTH_CALLBACK = `http://localhost:${MCP_SERVER_PORT}/oauth/callback`;
// The inspector is the OAuth client: both Auto (direct) and Proxy modes return
// to its own callback route, so the emulator must accept that redirect URI.
const INSPECTOR_OAUTH_CALLBACK =
  "http://localhost:3000/inspector/oauth/callback";

export const STATIC_CLIENT_ID =
  "mcp-emulate-test-client.apps.googleusercontent.com";
// The inspector is a public OAuth client (browser + PKCE) and never sends a
// client_secret, by design. The emulator compares secrets byte-for-byte, so a
// client seeded with an empty secret accepts token requests that carry none.
const PUBLIC_CLIENT_SECRET = "";

export const GOOGLE_MOCK_USER = {
  email: "testuser@example.com",
  name: "Test User",
};

type GoogleOAuthUser = {
  id: string;
  email?: string;
  name?: string;
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
            client_secret: PUBLIC_CLIENT_SECRET,
            redirect_uris: [
              MCP_SERVER_OAUTH_CALLBACK,
              INSPECTOR_OAUTH_CALLBACK,
            ],
          },
        ],
      },
    },
  });

  const emulatorUrl = emulator.url.replace(/\/$/, "");
  const resource = `http://localhost:${MCP_SERVER_PORT}/mcp`;

  try {
    const mcpServer = new MCPServer({
      name: "GoogleEmulateTestServer",
      version: "1.0.0",
      description: "MCP server backed by the emulate Google OAuth issuer",
      inspector: { enabled: false },
      oauth: oauthCustomProvider<GoogleOAuthUser>({
        resource,
        scopesSupported: ["openid", "email", "profile"],
        oauthMetadata: {
          issuer: emulatorUrl,
          authorization_endpoint: `${emulatorUrl}/o/oauth2/v2/auth`,
          token_endpoint: `${emulatorUrl}/oauth2/token`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          // Public client: no client authentication at the token endpoint.
          token_endpoint_auth_methods_supported: ["none"],
        },
        // The verifier is bound to the canonical MCP resource; v2 rejects
        // verified tokens that do not echo it back.
        createTokenVerifier: (protectedResource) => ({
          async verifyAccessToken(token: string) {
            const res = await fetch(`${emulatorUrl}/oauth2/v2/userinfo`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) {
              throw new Error(
                `userinfo verification failed: ${res.status} ${res.statusText}`
              );
            }
            const payload = (await res.json()) as Record<string, unknown>;
            return {
              token,
              clientId: STATIC_CLIENT_ID,
              scopes: ["openid", "email", "profile"],
              expiresAt: Math.floor(Date.now() / 1000) + 3600,
              resource: protectedResource,
              extra: { payload },
            };
          },
        }),
        mapAuthInfo: (authInfo) => {
          const payload =
            (authInfo.extra?.payload as Record<string, unknown> | undefined) ??
            {};
          return {
            user: {
              id: String(payload.sub ?? payload.email ?? ""),
              email:
                typeof payload.email === "string" ? payload.email : undefined,
              name: typeof payload.name === "string" ? payload.name : undefined,
            },
            payload,
            permissions: [],
          };
        },
      }),
    });

    mcpServer.tool(
      {
        name: "verify_auth",
        description: "Confirm OAuth authentication succeeded",
      },
      async (_params, ctx) => ({
        content: [
          {
            type: "text",
            text: `OAuth authentication successful for ${ctx.auth.user.email ?? "unknown"}`,
          },
        ],
      })
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
