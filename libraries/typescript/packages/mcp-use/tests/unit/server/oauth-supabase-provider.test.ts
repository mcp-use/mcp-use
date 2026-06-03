import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { oauthSupabaseProvider } from "../../../src/server/oauth/providers.js";

describe("oauthSupabaseProvider factory", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.MCP_USE_OAUTH_SUPABASE_PROJECT_ID;
    delete process.env.MCP_USE_OAUTH_SUPABASE_URL;
    delete process.env.MCP_USE_OAUTH_SUPABASE_JWT_SECRET;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("accepts supabaseUrl without projectId", () => {
    const provider = oauthSupabaseProvider({
      supabaseUrl: "http://localhost:54321",
    });

    expect(provider.getIssuer()).toBe("http://localhost:54321/auth/v1");
  });

  it("throws when neither projectId nor supabaseUrl is configured", () => {
    expect(() => oauthSupabaseProvider({})).toThrowError(
      /projectId or supabaseUrl is required/
    );
  });
});
