import { describe, expect, it } from "vitest";
import {
  buildLocalOAuthAuthorizationServerPath,
  buildOAuthAuthorizationServerMetadataUrl,
  buildOpenIdConfigurationMetadataUrl,
  getIssuerPath,
} from "../../../src/server/oauth/well-known.js";

describe("OAuth well-known URL helpers", () => {
  it("returns empty issuer path for root issuers", () => {
    expect(getIssuerPath("https://auth.example.com")).toBe("");
    expect(getIssuerPath("https://auth.example.com/")).toBe("");
  });

  it("returns normalized issuer path for path-suffix issuers", () => {
    expect(getIssuerPath("https://auth.example.com/oauth/2.1")).toBe(
      "/oauth/2.1"
    );
    expect(getIssuerPath("https://auth.example.com/oauth/2.1/")).toBe(
      "/oauth/2.1"
    );
  });

  it("builds RFC 8414 OAuth authorization server metadata URLs", () => {
    expect(
      buildOAuthAuthorizationServerMetadataUrl("https://auth.example.com")
    ).toBe("https://auth.example.com/.well-known/oauth-authorization-server");
    expect(
      buildOAuthAuthorizationServerMetadataUrl(
        "https://auth.example.com/oauth/2.1"
      )
    ).toBe(
      "https://auth.example.com/.well-known/oauth-authorization-server/oauth/2.1"
    );
  });

  it("builds OIDC openid-configuration metadata URLs", () => {
    expect(
      buildOpenIdConfigurationMetadataUrl("https://auth.example.com")
    ).toBe("https://auth.example.com/.well-known/openid-configuration");
    expect(
      buildOpenIdConfigurationMetadataUrl("https://auth.example.com/oauth/2.1")
    ).toBe(
      "https://auth.example.com/oauth/2.1/.well-known/openid-configuration"
    );
  });

  it("builds local mount paths with optional issuer path suffix", () => {
    expect(buildLocalOAuthAuthorizationServerPath("")).toBe(
      "/.well-known/oauth-authorization-server"
    );
    expect(buildLocalOAuthAuthorizationServerPath("/oauth/2.1")).toBe(
      "/.well-known/oauth-authorization-server/oauth/2.1"
    );
  });
});
