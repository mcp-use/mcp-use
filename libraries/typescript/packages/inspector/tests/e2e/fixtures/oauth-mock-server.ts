/**
 * OAuth 2.1 Mock Server for Testing
 *
 * Creates mock OAuth servers for different providers (Linear, Supabase, GitHub, Vercel)
 * using oauth2-mock-server package. Each provider runs on a separate port.
 */

import type { OAuth2Server } from "oauth2-mock-server";
import { MCPServer } from "@mcp-use/server";
import { oauthCustomProvider } from "@mcp-use/server/oauth";

type MockOAuthUser = {
  id: string;
  email: string;
  name: string;
};

export interface OAuthProviderConfig {
  name: string;
  port: number;
  mockUser: {
    sub: string;
    email: string;
    name: string;
    [key: string]: unknown;
  };
  scopes: string[];
}

export const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  linear: {
    name: "Linear",
    port: 3005,
    mockUser: {
      sub: "linear-user-123",
      email: "test@linear.app",
      name: "Test Linear User",
    },
    scopes: ["read", "write", "admin"],
  },
  supabase: {
    name: "Supabase",
    port: 3006,
    mockUser: {
      sub: "supabase-user-456",
      email: "test@supabase.io",
      name: "Test Supabase User",
      app_metadata: { provider: "email" },
    },
    scopes: ["openid", "email", "profile"],
  },
  github: {
    name: "GitHub",
    port: 3007,
    mockUser: {
      sub: "github-user-789",
      email: "test@github.com",
      name: "testuser",
      login: "testuser",
    },
    scopes: ["repo", "user", "read:org"],
  },
  vercel: {
    name: "Vercel",
    port: 3008,
    mockUser: {
      sub: "vercel-user-101",
      email: "test@vercel.com",
      name: "Test Vercel User",
      username: "testuser",
    },
    scopes: ["user", "team", "project"],
  },
};

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT format");
  }
  return JSON.parse(
    Buffer.from(parts[1]!, "base64url").toString("utf8")
  ) as Record<string, unknown>;
}

/**
 * Create an MCP server with OAuth authentication using a mock OAuth provider
 */
export function createOAuthMcpServer(providerKey: string) {
  const config = OAUTH_PROVIDERS[providerKey];
  if (!config) {
    throw new Error(`Unknown OAuth provider: ${providerKey}`);
  }

  const issuerUrl = `http://localhost:${config.port}`;
  const mcpPort = config.port + 100;
  const resource = `http://localhost:${mcpPort}/mcp`;

  const oauthProvider = oauthCustomProvider<MockOAuthUser>({
    resource,
    scopesSupported: config.scopes,
    oauthMetadata: {
      issuer: issuerUrl,
      authorization_endpoint: `${issuerUrl}/authorize`,
      token_endpoint: `${issuerUrl}/token`,
      jwks_uri: `${issuerUrl}/jwks`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
    },
    createTokenVerifier: () => ({
      async verifyAccessToken(token: string) {
        const payload = decodeJwtPayload(token);
        return {
          token,
          clientId:
            typeof payload.client_id === "string" ? payload.client_id : "test-client",
          scopes:
            typeof payload.scope === "string"
              ? payload.scope.split(" ").filter(Boolean)
              : config.scopes,
          expiresAt:
            typeof payload.exp === "number"
              ? payload.exp
              : Math.floor(Date.now() / 1000) + 3600,
          extra: { payload },
        };
      },
    }),
    mapAuthInfo: (authInfo) => {
      const payload =
        (authInfo.extra?.payload as Record<string, unknown> | undefined) ?? {};
      return {
        user: {
          id: String(payload.sub ?? ""),
          email: String(payload.email ?? ""),
          name: String(payload.name ?? ""),
        },
        payload,
        permissions: [],
      };
    },
  });

  const server = new MCPServer({
    name: `${config.name}OAuthTestServer`,
    version: "1.0.0",
    description: `MCP server with ${config.name} OAuth authentication for testing`,
    oauth: oauthProvider,
    inspector: { enabled: false },
  });

  server.tool(
    {
      name: "get_user_info",
      description: "Get information about the authenticated user",
    },
    async (_params, ctx) => {
      const data = {
        userId: ctx.auth.user.id,
        email: ctx.auth.user.email,
        name: ctx.auth.user.name,
        provider: config.name,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(data) }],
        structuredContent: data,
      };
    }
  );

  server.tool(
    {
      name: "verify_auth",
      description: "Verify that OAuth authentication is working",
    },
    async (_params, ctx) => ({
      content: [
        {
          type: "text",
          text: `OAuth authentication successful for ${config.name}! User: ${ctx.auth.user.email}`,
        },
      ],
    })
  );

  server.tool(
    {
      name: "get_scopes",
      description: "Get the OAuth scopes for the authenticated user",
    },
    async (_params, ctx) => {
      const data = {
        scopes: ctx.auth.scopes,
        provider: config.name,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(data) }],
        structuredContent: data,
      };
    }
  );

  return server;
}

export class OAuthMockServerHelper {
  private providerKey: string;
  private config: OAuthProviderConfig;
  public oauthServer: OAuth2Server | null = null;
  public mcpServer: ReturnType<typeof createOAuthMcpServer> | null = null;

  constructor(providerKey: string) {
    this.providerKey = providerKey;
    this.config = OAUTH_PROVIDERS[providerKey]!;
    if (!this.config) {
      throw new Error(`Unknown OAuth provider: ${providerKey}`);
    }
  }

  async start() {
    try {
      const { default: OAuth2Server } = await import("oauth2-mock-server");

      this.oauthServer = new OAuth2Server();
      await this.oauthServer.issuer.keys.generate("RS256");
      await this.oauthServer.start(this.config.port, "localhost");

      console.log(
        `[${this.config.name}] OAuth mock server started on port ${this.config.port}`
      );

      this.mcpServer = createOAuthMcpServer(this.providerKey);

      const mcpPort = this.config.port + 100;
      await this.mcpServer.listen(mcpPort);

      console.log(
        `[${this.config.name}] MCP server with OAuth started on port ${mcpPort}`
      );
    } catch (error) {
      console.error(
        `[${this.config.name}] Failed to start OAuth mock server:`,
        error
      );
      throw error;
    }
  }

  async stop() {
    if (this.oauthServer) {
      await this.oauthServer.stop();
      console.log(`[${this.config.name}] OAuth mock server stopped`);
    }
    if (this.mcpServer) {
      await this.mcpServer.close();
      console.log(`[${this.config.name}] MCP server stopped`);
    }
  }

  getOAuthUrl(): string {
    return `http://localhost:${this.config.port}`;
  }

  getMcpUrl(): string {
    return `http://localhost:${this.config.port + 100}/mcp`;
  }

  getMcpPort(): number {
    return this.config.port + 100;
  }

  getProviderName(): string {
    return this.config.name;
  }

  getMockUser() {
    return this.config.mockUser;
  }

  async generateToken(): Promise<string> {
    if (!this.oauthServer) {
      throw new Error("OAuth server not started");
    }

    return this.oauthServer.issuer.buildToken({
      payload: {
        ...this.config.mockUser,
        scope: this.config.scopes.join(" "),
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
    });
  }
}
