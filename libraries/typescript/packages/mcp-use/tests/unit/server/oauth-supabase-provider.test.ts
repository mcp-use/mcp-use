import { describe, expect, it } from "vitest";
import { SupabaseOAuthProvider } from "../../../src/server/oauth/providers/supabase.js";
import { oauthSupabaseProvider } from "../../../src/server/oauth/providers.js";

describe("SupabaseOAuthProvider URL resolution", () => {
  it("derives hosted URLs from projectId", () => {
    const provider = new SupabaseOAuthProvider({
      provider: "supabase",
      projectId: "abcd1234",
    });

    expect(provider.getIssuer()).toBe("https://abcd1234.supabase.co/auth/v1");
    expect(provider.getAuthEndpoint()).toBe(
      "https://abcd1234.supabase.co/auth/v1/oauth/authorize"
    );
    expect(provider.getTokenEndpoint()).toBe(
      "https://abcd1234.supabase.co/auth/v1/oauth/token"
    );
  });

  it("uses supabaseUrl override when provided", () => {
    const provider = new SupabaseOAuthProvider({
      provider: "supabase",
      supabaseUrl: "http://localhost:54321",
    });

    expect(provider.getIssuer()).toBe("http://localhost:54321/auth/v1");
    expect(provider.getAuthEndpoint()).toBe(
      "http://localhost:54321/auth/v1/oauth/authorize"
    );
    expect(provider.getTokenEndpoint()).toBe(
      "http://localhost:54321/auth/v1/oauth/token"
    );
  });

  it("prefers supabaseUrl over projectId when both are set", () => {
    const provider = new SupabaseOAuthProvider({
      provider: "supabase",
      projectId: "ignored",
      supabaseUrl: "https://supabase.internal.example.com",
    });

    expect(provider.getIssuer()).toBe(
      "https://supabase.internal.example.com/auth/v1"
    );
  });

  it("strips a trailing slash from supabaseUrl", () => {
    const provider = new SupabaseOAuthProvider({
      provider: "supabase",
      supabaseUrl: "http://localhost:54321/",
    });

    expect(provider.getIssuer()).toBe("http://localhost:54321/auth/v1");
  });

  it("throws if neither projectId nor supabaseUrl is provided", () => {
    expect(
      () => new SupabaseOAuthProvider({ provider: "supabase" })
    ).toThrowError(/requires either `supabaseUrl` or `projectId`/);
  });
});

describe("oauthSupabaseProvider factory", () => {
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
