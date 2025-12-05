/**
 * Integration tests for OAuth modes (proxy and direct)
 *
 * Tests that verify:
 * 1. OAuth server initialization with both modes
 * 2. Tool registration and discovery
 * 3. Tool execution with authentication
 * 4. OAuth metadata endpoints
 * 5. Bearer token authentication
 *
 * To run with OpenAI API key (for testing with real LLM calls):
 *   OPENAI_API_KEY=your-key npm test -- tests/integration/oauth-modes.test.ts
 *
 * These tests use mock OAuth providers by default to avoid external dependencies.
 * The tests verify that OAuth authentication works correctly for both proxy and direct modes.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createMCPServer,
  oauthCustomProvider,
} from "../../src/server/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthMode } from "../../src/server/oauth/providers/types.js";

// Mock JWT tokens for testing
const createMockToken = (payload: any): string => {
  // Simple base64 encoding for test tokens (not real JWT)
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = btoa(JSON.stringify(payload));
  const signature = btoa("mock-signature");
  return `${header}.${body}.${signature}`;
};

// Mock OAuth provider for proxy mode
const createProxyModeProvider = () => {
  return oauthCustomProvider({
    issuer: "https://auth.example.com",
    jwksUrl: "https://auth.example.com/.well-known/jwks.json",
    authEndpoint: "https://auth.example.com/authorize",
    tokenEndpoint: "https://auth.example.com/token",
    scopesSupported: ["openid", "profile", "email"],
    grantTypesSupported: ["authorization_code", "refresh_token"],
    verifyToken: async (token: string) => {
      // Decode mock token
      const parts = token.split(".");
      if (parts.length !== 3) {
        throw new Error("Invalid token format");
      }
      const payload = JSON.parse(atob(parts[1]));

      // Verify it's a valid test token
      if (!payload.sub) {
        throw new Error("Invalid token: missing sub claim");
      }

      return payload;
    },
    getUserInfo: (payload: any) => ({
      userId: payload.sub,
      email: payload.email || "test@example.com",
      name: payload.name || "Test User",
      roles: payload.roles || [],
      permissions: payload.permissions || [],
    }),
  });
};

// Mock OAuth provider for direct mode
const createDirectModeProvider = () => {
  const baseProvider = createProxyModeProvider();
  // Create a new provider instance with direct mode
  const provider = oauthCustomProvider({
    issuer: "https://auth.example.com",
    jwksUrl: "https://auth.example.com/.well-known/jwks.json",
    authEndpoint: "https://auth.example.com/authorize",
    tokenEndpoint: "https://auth.example.com/token",
    scopesSupported: ["openid", "profile", "email"],
    grantTypesSupported: ["authorization_code", "refresh_token"],
    verifyToken: baseProvider.verifyToken.bind(baseProvider),
    getUserInfo: baseProvider.getUserInfo.bind(baseProvider),
  });

  // Add getMode method to direct mode provider
  (provider as any).getMode = (): OAuthMode => "direct";
  (provider as any).getRegistrationEndpoint = () =>
    "https://auth.example.com/oauth2/register";

  return provider;
};

describe("OAuth Modes Integration Tests", () => {
  describe("Proxy Mode", () => {
    let server: any;
    const TEST_PORT = 3100;
    const SERVER_URL = `http://localhost:${TEST_PORT}/mcp`;

    beforeAll(async () => {
      // Create server with proxy mode OAuth
      server = createMCPServer("test-oauth-proxy-server", {
        version: "1.0.0",
        oauth: createProxyModeProvider(),
      });

      // Add demo tools
      server.tool({
        name: "get_user_info",
        description: "Get information about the authenticated user",
        inputs: [],
        cb: async (_: any, ctx: any) => {
          const auth = ctx.auth;
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  userId: auth.user.userId,
                  email: auth.user.email,
                  name: auth.user.name,
                }),
              },
            ],
          };
        },
      });

      server.tool({
        name: "calculate_sum",
        description: "Calculate the sum of two numbers",
        inputs: {
          type: "object",
          properties: {
            a: { type: "number", description: "First number" },
            b: { type: "number", description: "Second number" },
          },
          required: ["a", "b"],
        },
        cb: async (params: { a: number; b: number }, ctx: any) => {
          const auth = ctx.auth;
          const sum = params.a + params.b;
          return {
            content: [
              {
                type: "text",
                text: `User ${auth.user.userId} calculated: ${params.a} + ${params.b} = ${sum}`,
              },
            ],
          };
        },
      });

      server.tool({
        name: "search_data",
        description: "Search through data with a query",
        inputs: [
          {
            name: "query",
            type: "string",
            required: true,
            description: "Search query",
          },
          {
            name: "limit",
            type: "number",
            required: false,
            description: "Maximum number of results",
          },
        ],
        cb: async (params: { query: string; limit?: number }, ctx: any) => {
          const auth = ctx.auth;
          // Mock search results
          const results = [
            `Result 1 for "${params.query}"`,
            `Result 2 for "${params.query}"`,
            `Result 3 for "${params.query}"`,
          ].slice(0, params.limit || 10);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  query: params.query,
                  results,
                  searchedBy: auth.user.userId,
                }),
              },
            ],
          };
        },
      });

      // Start server
      await server.listen(TEST_PORT);
      // Note: Client connections are created in each test with proper authentication
    });

    afterAll(async () => {
      // Server cleanup handled by vitest
    });

    it("should list available tools", async () => {
      const mockToken = createMockToken({
        sub: "user-123",
        email: "test@example.com",
        name: "Test User",
      });

      // Create a new transport with authentication headers
      const authTransport = new StreamableHTTPClientTransport(
        new URL(SERVER_URL),
        {
          requestInit: {
            headers: {
              Authorization: `Bearer ${mockToken}`,
            },
          },
        }
      );

      const authClient = new Client(
        { name: "test-client", version: "1.0.0" },
        {
          capabilities: {
            roots: { listChanged: true },
          },
        }
      );

      await authClient.connect(authTransport);

      const tools = await authClient.listTools();

      expect(tools.tools).toBeDefined();
      expect(tools.tools.length).toBeGreaterThanOrEqual(3);

      const toolNames = tools.tools.map((t) => t.name);
      expect(toolNames).toContain("get_user_info");
      expect(toolNames).toContain("calculate_sum");
      expect(toolNames).toContain("search_data");

      await authClient.close();
    });

    it("should execute get_user_info tool with authentication", async () => {
      const mockToken = createMockToken({
        sub: "user-456",
        email: "user@example.com",
        name: "Authenticated User",
      });

      const authTransport = new StreamableHTTPClientTransport(
        new URL(SERVER_URL),
        {
          requestInit: {
            headers: {
              Authorization: `Bearer ${mockToken}`,
            },
          },
        }
      );

      const authClient = new Client(
        { name: "test-client", version: "1.0.0" },
        {
          capabilities: {
            roots: { listChanged: true },
          },
        }
      );

      await authClient.connect(authTransport);

      const result = await authClient.callTool({
        name: "get_user_info",
        arguments: {},
      });

      expect(result.isError).toBeFalsy();
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0].text).toContain("user-456");
      expect(content[0].text).toContain("user@example.com");
      expect(content[0].text).toContain("Authenticated User");

      await authClient.close();
    });

    it("should execute calculate_sum tool with authentication", async () => {
      const mockToken = createMockToken({
        sub: "user-789",
        email: "calc@example.com",
      });

      const authTransport = new StreamableHTTPClientTransport(
        new URL(SERVER_URL),
        {
          requestInit: {
            headers: {
              Authorization: `Bearer ${mockToken}`,
            },
          },
        }
      );

      const authClient = new Client(
        { name: "test-client", version: "1.0.0" },
        {
          capabilities: {
            roots: { listChanged: true },
          },
        }
      );

      await authClient.connect(authTransport);

      const result = await authClient.callTool({
        name: "calculate_sum",
        arguments: { a: 15, b: 27 },
      });

      expect(result.isError).toBeFalsy();
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0].text).toContain("user-789");
      expect(content[0].text).toContain("15 + 27 = 42");

      await authClient.close();
    });

    it("should execute search_data tool with authentication", async () => {
      const mockToken = createMockToken({
        sub: "user-search",
        email: "search@example.com",
      });

      const authTransport = new StreamableHTTPClientTransport(
        new URL(SERVER_URL),
        {
          requestInit: {
            headers: {
              Authorization: `Bearer ${mockToken}`,
            },
          },
        }
      );

      const authClient = new Client(
        { name: "test-client", version: "1.0.0" },
        {
          capabilities: {
            roots: { listChanged: true },
          },
        }
      );

      await authClient.connect(authTransport);

      const result = await authClient.callTool({
        name: "search_data",
        arguments: { query: "test query", limit: 2 },
      });

      expect(result.isError).toBeFalsy();
      const content = result.content as Array<{ type: string; text: string }>;
      const data = JSON.parse(content[0].text);
      expect(data.query).toBe("test query");
      expect(data.results).toHaveLength(2);
      expect(data.searchedBy).toBe("user-search");
      expect(data.results[0]).toContain("test query");

      await authClient.close();
    });

    it("should reject requests without authentication", async () => {
      // Create transport without authentication
      const noAuthTransport = new StreamableHTTPClientTransport(
        new URL(SERVER_URL)
      );

      const noAuthClient = new Client(
        { name: "test-client", version: "1.0.0" },
        {
          capabilities: {
            roots: { listChanged: true },
          },
        }
      );

      await noAuthClient.connect(noAuthTransport);

      try {
        await noAuthClient.listTools();
        expect.fail("Should have thrown an error");
      } catch (error: any) {
        expect(error).toBeDefined();
        // Should receive 401 Unauthorized
      }

      await noAuthClient.close();
    });

    it("should reject requests with invalid token", async () => {
      const invalidTransport = new StreamableHTTPClientTransport(
        new URL(SERVER_URL),
        {
          requestInit: {
            headers: {
              Authorization: "Bearer invalid-token",
            },
          },
        }
      );

      const invalidClient = new Client(
        { name: "test-client", version: "1.0.0" },
        {
          capabilities: {
            roots: { listChanged: true },
          },
        }
      );

      await invalidClient.connect(invalidTransport);

      try {
        await invalidClient.listTools();
        expect.fail("Should have thrown an error");
      } catch (error: any) {
        expect(error).toBeDefined();
        // Should receive 401 Unauthorized
      }

      await invalidClient.close();
    });

    it("should provide OAuth metadata endpoints", async () => {
      const response = await fetch(
        `http://localhost:${TEST_PORT}/.well-known/oauth-authorization-server`
      );
      expect(response.ok).toBe(true);

      const metadata = (await response.json()) as {
        issuer: string;
        authorization_endpoint: string;
        token_endpoint: string;
        scopes_supported: string[];
      };
      expect(metadata.issuer).toBe("https://auth.example.com");
      expect(metadata.authorization_endpoint).toContain("/authorize");
      expect(metadata.token_endpoint).toContain("/token");
      expect(metadata.scopes_supported).toContain("openid");
    });

    it("should provide protected resource metadata", async () => {
      const response = await fetch(
        `http://localhost:${TEST_PORT}/.well-known/oauth-protected-resource`
      );
      expect(response.ok).toBe(true);

      const metadata = (await response.json()) as {
        authorization_servers: string[];
        bearer_methods_supported: string[];
      };
      expect(metadata.authorization_servers).toContain(
        "https://auth.example.com"
      );
      expect(metadata.bearer_methods_supported).toContain("header");
    });
  });

  describe("Direct Mode", () => {
    let server: any;
    const TEST_PORT = 3101;
    const SERVER_URL = `http://localhost:${TEST_PORT}/mcp`;

    beforeAll(async () => {
      // Create server with direct mode OAuth
      server = createMCPServer("test-oauth-direct-server", {
        version: "1.0.0",
        oauth: createDirectModeProvider(),
      });

      // Add demo tools (same as proxy mode for consistency)
      server.tool({
        name: "get_user_info",
        description: "Get information about the authenticated user",
        inputs: [],
        cb: async (_: any, ctx: any) => {
          const auth = ctx.auth;
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  userId: auth.user.userId,
                  email: auth.user.email,
                  name: auth.user.name,
                }),
              },
            ],
          };
        },
      });

      server.tool({
        name: "calculate_sum",
        description: "Calculate the sum of two numbers",
        inputs: [
          {
            name: "a",
            type: "number",
            required: true,
            description: "First number",
          },
          {
            name: "b",
            type: "number",
            required: true,
            description: "Second number",
          },
        ],
        cb: async (params: { a: number; b: number }, ctx: any) => {
          const auth = ctx.auth;
          const sum = params.a + params.b;
          return {
            content: [
              {
                type: "text",
                text: `User ${auth.user.userId} calculated: ${params.a} + ${params.b} = ${sum}`,
              },
            ],
          };
        },
      });

      server.tool({
        name: "search_data",
        description: "Search through data with a query",
        inputs: [
          {
            name: "query",
            type: "string",
            required: true,
            description: "Search query",
          },
          {
            name: "limit",
            type: "number",
            required: false,
            description: "Maximum number of results",
          },
        ],
        cb: async (params: { query: string; limit?: number }, ctx: any) => {
          const auth = ctx.auth;
          // Mock search results
          const results = [
            `Result 1 for "${params.query}"`,
            `Result 2 for "${params.query}"`,
            `Result 3 for "${params.query}"`,
          ].slice(0, params.limit || 10);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  query: params.query,
                  results,
                  searchedBy: auth.user.userId,
                }),
              },
            ],
          };
        },
      });

      // Start server
      await server.listen(TEST_PORT);
      // Note: Client connections are created in each test with proper authentication
    });

    afterAll(async () => {
      // Server cleanup handled by vitest
    });

    it("should list available tools", async () => {
      const mockToken = createMockToken({
        sub: "direct-user-123",
        email: "direct@example.com",
        name: "Direct Mode User",
      });

      const authTransport = new StreamableHTTPClientTransport(
        new URL(SERVER_URL),
        {
          requestInit: {
            headers: {
              Authorization: `Bearer ${mockToken}`,
            },
          },
        }
      );

      const authClient = new Client(
        { name: "test-client", version: "1.0.0" },
        {
          capabilities: {
            roots: { listChanged: true },
          },
        }
      );

      await authClient.connect(authTransport);

      const tools = await authClient.listTools();

      expect(tools.tools).toBeDefined();
      expect(tools.tools.length).toBeGreaterThanOrEqual(3);

      const toolNames = tools.tools.map((t) => t.name);
      expect(toolNames).toContain("get_user_info");
      expect(toolNames).toContain("calculate_sum");
      expect(toolNames).toContain("search_data");

      await authClient.close();
    });

    it("should execute get_user_info tool with authentication", async () => {
      const mockToken = createMockToken({
        sub: "direct-user-456",
        email: "direct-user@example.com",
        name: "Direct Authenticated User",
      });

      const authTransport = new StreamableHTTPClientTransport(
        new URL(SERVER_URL),
        {
          requestInit: {
            headers: {
              Authorization: `Bearer ${mockToken}`,
            },
          },
        }
      );

      const authClient = new Client(
        { name: "test-client", version: "1.0.0" },
        {
          capabilities: {
            roots: { listChanged: true },
          },
        }
      );

      await authClient.connect(authTransport);

      const result = await authClient.callTool({
        name: "get_user_info",
        arguments: {},
      });

      expect(result.isError).toBeFalsy();
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0].text).toContain("direct-user-456");
      expect(content[0].text).toContain("direct-user@example.com");

      await authClient.close();
    });

    it("should execute calculate_sum tool with authentication", async () => {
      const mockToken = createMockToken({
        sub: "direct-user-789",
        email: "direct-calc@example.com",
      });

      const authTransport = new StreamableHTTPClientTransport(
        new URL(SERVER_URL),
        {
          requestInit: {
            headers: {
              Authorization: `Bearer ${mockToken}`,
            },
          },
        }
      );

      const authClient = new Client(
        { name: "test-client", version: "1.0.0" },
        {
          capabilities: {
            roots: { listChanged: true },
          },
        }
      );

      await authClient.connect(authTransport);

      const result = await authClient.callTool({
        name: "calculate_sum",
        arguments: { a: 100, b: 200 },
      });

      expect(result.isError).toBeFalsy();
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0].text).toContain("direct-user-789");
      expect(content[0].text).toContain("100 + 200 = 300");

      await authClient.close();
    });

    it("should execute search_data tool with authentication", async () => {
      const mockToken = createMockToken({
        sub: "direct-user-search",
        email: "direct-search@example.com",
      });

      const authTransport = new StreamableHTTPClientTransport(
        new URL(SERVER_URL),
        {
          requestInit: {
            headers: {
              Authorization: `Bearer ${mockToken}`,
            },
          },
        }
      );

      const authClient = new Client(
        { name: "test-client", version: "1.0.0" },
        {
          capabilities: {
            roots: { listChanged: true },
          },
        }
      );

      await authClient.connect(authTransport);

      const result = await authClient.callTool({
        name: "search_data",
        arguments: { query: "direct mode search", limit: 3 },
      });

      expect(result.isError).toBeFalsy();
      const content = result.content as Array<{ type: string; text: string }>;
      const data = JSON.parse(content[0].text);
      expect(data.query).toBe("direct mode search");
      expect(data.results).toHaveLength(3);
      expect(data.searchedBy).toBe("direct-user-search");

      await authClient.close();
    });

    it("should provide OAuth metadata endpoints (direct mode)", async () => {
      // In direct mode, the server tries to fetch metadata from the provider
      // Since we're using a mock provider, we'll mock the fetch
      const originalFetch = global.fetch;
      global.fetch = async (url: any) => {
        if (url.toString().includes("oauth-authorization-server")) {
          return new Response(
            JSON.stringify({
              issuer: "https://auth.example.com",
              authorization_endpoint: "https://auth.example.com/authorize",
              token_endpoint: "https://auth.example.com/token",
              registration_endpoint: "https://auth.example.com/oauth2/register",
              scopes_supported: ["openid", "profile", "email"],
              grant_types_supported: ["authorization_code", "refresh_token"],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return originalFetch(url);
      };

      try {
        const response = await fetch(
          `http://localhost:${TEST_PORT}/.well-known/oauth-authorization-server`
        );
        expect(response.ok).toBe(true);

        const metadata = (await response.json()) as {
          issuer: string;
          authorization_endpoint: string;
          token_endpoint: string;
        };
        // In direct mode, the metadata should come from the provider
        expect(metadata.issuer).toBe("https://auth.example.com");
        expect(metadata.authorization_endpoint).toBe(
          "https://auth.example.com/authorize"
        );
        expect(metadata.token_endpoint).toBe("https://auth.example.com/token");
      } finally {
        global.fetch = originalFetch;
      }
    });

    it("should provide protected resource metadata (direct mode)", async () => {
      const response = await fetch(
        `http://localhost:${TEST_PORT}/.well-known/oauth-protected-resource`
      );
      expect(response.ok).toBe(true);

      type ProtectedResourceMetadata = {
        authorization_servers: string[];
        bearer_methods_supported: string[];
      };
      const metadata = (await response.json()) as ProtectedResourceMetadata;
      expect(metadata.authorization_servers).toContain(
        "https://auth.example.com"
      );
      expect(metadata.bearer_methods_supported).toContain("header");
    });

    it("should not have /authorize and /token endpoints in direct mode", async () => {
      // In direct mode, these endpoints should not exist on the server
      // (clients communicate directly with the provider)
      const authorizeResponse = await fetch(
        `http://localhost:${TEST_PORT}/authorize`
      );
      // Should return 404 or not be a redirect to provider
      expect([404, 405]).toContain(authorizeResponse.status);

      const tokenResponse = await fetch(`http://localhost:${TEST_PORT}/token`, {
        method: "POST",
      });
      // Should return 404 or error
      expect([404, 405, 500]).toContain(tokenResponse.status);
    });
  });
});
