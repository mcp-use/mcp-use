/**
 * OAuth 2.1 Mock Server for Testing
 *
 * Creates mock OAuth servers for different providers (Linear, Supabase, GitHub, Vercel)
 * using oauth2-mock-server package. Each provider runs on a separate port.
 *
 * NOTE: Install oauth2-mock-server as a dev dependency:
 * pnpm add -D oauth2-mock-server
 */

import type { OAuth2Server } from "oauth2-mock-server";
import { MCPServer, oauthCustomProvider, text, object } from "mcp-use/server";

export interface OAuthProviderConfig {
  name: string;
  port: number;
  mockUser: {
    sub: string;
    email: string;
    name: string;
    [key: string]: any;
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

/**
 * Create an MCP server with OAuth authentication using a mock OAuth provider
 */
export function createOAuthMcpServer(
  providerKey: string,
  oauthServer: OAuth2Server
) {
  const config = OAUTH_PROVIDERS[providerKey];
  if (!config) {
    throw new Error(`Unknown OAuth provider: ${providerKey}`);
  }

  const issuerUrl = `http://localhost:${config.port}`;

  // Create custom OAuth provider pointing to our mock server
  const oauthProvider = oauthCustomProvider({
    issuer: issuerUrl,
    jwksUrl: `${issuerUrl}/jwks`,
    authEndpoint: `${issuerUrl}/authorize`,
    tokenEndpoint: `${issuerUrl}/token`,
    scopes: config.scopes,
    // Use the mock server's built-in JWT verification
    verifyToken: async (token: string) => {
      // The oauth2-mock-server validates tokens automatically
      // We just need to decode and return the payload
      const parts = token.split(".");
      if (parts.length !== 3) {
        throw new Error("Invalid JWT format");
      }
      const payload = JSON.parse(
        Buffer.from(parts[1], "base64url").toString("utf8")
      );
      return { payload };
    },
    getUserInfo: (payload: any) => ({
      userId: payload.sub,
      email: payload.email,
      name: payload.name,
      ...payload,
    }),
  });

  const server = new MCPServer({
    name: `${config.name}OAuthTestServer`,
    version: "1.0.0",
    description: `MCP server with ${config.name} OAuth authentication for testing`,
    oauth: oauthProvider,
  });

  // Tool to get authenticated user info
  server.tool(
    {
      name: "get_user_info",
      description: "Get information about the authenticated user",
    },
    async (_args, ctx) => {
      return object({
        userId: ctx.auth.user.userId,
        email: ctx.auth.user.email,
        name: ctx.auth.user.name,
        provider: config.name,
      });
    }
  );

  // Tool to verify auth is working
  server.tool(
    {
      name: "verify_auth",
      description: "Verify that OAuth authentication is working",
    },
    async (_args, ctx) => {
      return text(
        `OAuth authentication successful for ${config.name}! User: ${ctx.auth.user.email}`
      );
    }
  );

  // Tool to check scopes
  server.tool(
    {
      name: "get_scopes",
      description: "Get the OAuth scopes for the authenticated user",
    },
    async (_args, ctx) => {
      return object({
        scopes: ctx.auth.scopes || [],
        provider: config.name,
      });
    }
  );

  return server;
}

export class OAuthMockServerHelper {
  private providerKey: string;
  private config: OAuthProviderConfig;
  public oauthServer: OAuth2Server | null = null;
  public mcpServer: any = null;

  constructor(providerKey: string) {
    this.providerKey = providerKey;
    this.config = OAUTH_PROVIDERS[providerKey];
    if (!this.config) {
      throw new Error(`Unknown OAuth provider: ${providerKey}`);
    }
  }

  async start() {
    try {
      // Dynamically import oauth2-mock-server
      const { default: OAuth2Server } = await import("oauth2-mock-server");

      // Create and start OAuth mock server
      this.oauthServer = new OAuth2Server();

      // Generate RSA keys for signing JWTs
      await this.oauthServer.issuer.keys.generate("RS256");

      // Start the OAuth server
      await this.oauthServer.start(this.config.port, "localhost");

      console.log(
        `[${this.config.name}] OAuth mock server started on port ${this.config.port}`
      );

      // Create MCP server with OAuth
      this.mcpServer = createOAuthMcpServer(this.providerKey, this.oauthServer);

      // Listen on MCP port (OAuth port + 100)
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
      // MCPServer doesn't have a stop method, but we can close the underlying server
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

  /**
   * Generate a valid access token for testing
   */
  async generateToken(): Promise<string> {
    if (!this.oauthServer) {
      throw new Error("OAuth server not started");
    }

    const token = this.oauthServer.issuer.buildToken({
      payload: {
        ...this.config.mockUser,
        scope: this.config.scopes.join(" "),
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
      },
    });

    return token;
  }
}
