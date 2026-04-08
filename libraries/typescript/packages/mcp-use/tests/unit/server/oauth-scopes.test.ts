/**
 * OAuth Scopes Customization Tests
 *
 * Verifies that all OAuth providers support customizable scopes via
 * the `scopesSupported` config option, while preserving default behavior.
 */

import { describe, it, expect } from "vitest";
import { Auth0OAuthProvider } from "../../../src/server/oauth/providers/auth0.js";
import { KeycloakOAuthProvider } from "../../../src/server/oauth/providers/keycloak.js";
import { WorkOSOAuthProvider } from "../../../src/server/oauth/providers/workos.js";
import { SupabaseOAuthProvider } from "../../../src/server/oauth/providers/supabase.js";
import { CustomOAuthProvider } from "../../../src/server/oauth/providers/custom.js";

describe("OAuth Provider getScopesSupported()", () => {
  describe("Auth0", () => {
    it("returns default scopes when scopesSupported is not configured", () => {
      const provider = new Auth0OAuthProvider({
        provider: "auth0",
        domain: "test.auth0.com",
        audience: "https://api.example.com",
      });
      expect(provider.getScopesSupported()).toEqual([
        "openid",
        "profile",
        "email",
        "offline_access",
      ]);
    });

    it("returns custom scopes when scopesSupported is configured", () => {
      const customScopes = ["openid", "email", "read:users", "admin"];
      const provider = new Auth0OAuthProvider({
        provider: "auth0",
        domain: "test.auth0.com",
        audience: "https://api.example.com",
        scopesSupported: customScopes,
      });
      expect(provider.getScopesSupported()).toEqual(customScopes);
    });

    it("returns empty array when scopesSupported is set to empty", () => {
      const provider = new Auth0OAuthProvider({
        provider: "auth0",
        domain: "test.auth0.com",
        audience: "https://api.example.com",
        scopesSupported: [],
      });
      expect(provider.getScopesSupported()).toEqual([]);
    });
  });

  describe("Keycloak", () => {
    it("returns default scopes when scopesSupported is not configured", () => {
      const provider = new KeycloakOAuthProvider({
        provider: "keycloak",
        serverUrl: "https://keycloak.example.com",
        realm: "test-realm",
      });
      expect(provider.getScopesSupported()).toEqual([
        "openid",
        "profile",
        "email",
        "offline_access",
        "roles",
      ]);
    });

    it("returns custom scopes when scopesSupported is configured", () => {
      const customScopes = ["openid", "profile", "custom:scope"];
      const provider = new KeycloakOAuthProvider({
        provider: "keycloak",
        serverUrl: "https://keycloak.example.com",
        realm: "test-realm",
        scopesSupported: customScopes,
      });
      expect(provider.getScopesSupported()).toEqual(customScopes);
    });
  });

  describe("WorkOS", () => {
    it("returns default scopes when scopesSupported is not configured", () => {
      const provider = new WorkOSOAuthProvider({
        provider: "workos",
        subdomain: "test.authkit.app",
      });
      expect(provider.getScopesSupported()).toEqual([
        "email",
        "offline_access",
        "openid",
        "profile",
      ]);
    });

    it("returns custom scopes when scopesSupported is configured", () => {
      const customScopes = ["openid", "email", "org:read"];
      const provider = new WorkOSOAuthProvider({
        provider: "workos",
        subdomain: "test.authkit.app",
        scopesSupported: customScopes,
      });
      expect(provider.getScopesSupported()).toEqual(customScopes);
    });
  });

  describe("Supabase", () => {
    it("returns empty array by default when scopesSupported is not configured", () => {
      const provider = new SupabaseOAuthProvider({
        provider: "supabase",
        projectId: "test-project",
      });
      expect(provider.getScopesSupported()).toEqual([]);
    });

    it("returns custom scopes when scopesSupported is configured", () => {
      const customScopes = ["openid", "email"];
      const provider = new SupabaseOAuthProvider({
        provider: "supabase",
        projectId: "test-project",
        scopesSupported: customScopes,
      });
      expect(provider.getScopesSupported()).toEqual(customScopes);
    });
  });

  describe("Custom", () => {
    const baseCustomConfig = {
      provider: "custom" as const,
      issuer: "https://oauth.example.com",
      jwksUrl: "https://oauth.example.com/.well-known/jwks.json",
      authEndpoint: "https://oauth.example.com/authorize",
      tokenEndpoint: "https://oauth.example.com/token",
      verifyToken: async (token: string) => ({
        payload: { sub: "user-1" } as Record<string, unknown>,
      }),
    };

    it("returns default scopes when scopesSupported is not configured", () => {
      const provider = new CustomOAuthProvider(baseCustomConfig);
      expect(provider.getScopesSupported()).toEqual([
        "openid",
        "profile",
        "email",
      ]);
    });

    it("returns custom scopes when scopesSupported is configured", () => {
      const customScopes = ["openid", "api:read", "api:write"];
      const provider = new CustomOAuthProvider({
        ...baseCustomConfig,
        scopesSupported: customScopes,
      });
      expect(provider.getScopesSupported()).toEqual(customScopes);
    });
  });
});
