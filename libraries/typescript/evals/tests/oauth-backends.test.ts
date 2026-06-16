import { createRemoteJWKSet, jwtVerify } from "jose";
import { afterEach, describe, expect, it } from "vitest";
import { freePort } from "../src/graders/outcome.js";
import {
  CLERK_SEED,
  OKTA_SEED,
  startOAuthBackend,
  type OAuthBackend,
} from "../src/oauth-backends.js";

/**
 * Real-behavior tests: boot the actual emulators, run the actual headless
 * authorization-code flow, and verify the issued JWT exactly the way the
 * server under test will (remote JWKS + issuer/audience claims). If these
 * pass, a correct agent solution can pass grading.
 */
describe("oauth backends", () => {
  let backend: OAuthBackend | null = null;
  afterEach(async () => {
    await backend?.stop();
    backend = null;
  });

  it("clerk: serves the JWKS where mcp-use's ClerkOAuthProvider looks, and issues a verifiable token", async () => {
    backend = await startOAuthBackend("clerk", await freePort());

    expect(backend.env.MCP_USE_OAUTH_CLERK_FRONTEND_API_URL).toBe(
      backend.baseUrl
    );

    // ClerkOAuthProvider hardcodes ${frontendApiUrl}/.well-known/jwks.json —
    // the emulator only has /v1/jwks, so the backend must alias it.
    const jwksRes = await fetch(`${backend.baseUrl}/.well-known/jwks.json`);
    expect(jwksRes.status).toBe(200);
    const jwks = (await jwksRes.json()) as { keys: unknown[] };
    expect(jwks.keys.length).toBeGreaterThan(0);

    const metadataRes = await fetch(
      `${backend.baseUrl}/.well-known/oauth-authorization-server`
    );
    expect(metadataRes.status).toBe(200);
    const metadata = (await metadataRes.json()) as {
      issuer?: string;
      registration_endpoint?: string;
    };
    expect(metadata.issuer).toBe(backend.baseUrl);
    expect(metadata.registration_endpoint).toBeUndefined();

    const token = await backend.getToken();
    const { payload, protectedHeader } = await jwtVerify(
      token,
      createRemoteJWKSet(new URL(`${backend.baseUrl}/.well-known/jwks.json`)),
      { issuer: backend.baseUrl }
    );
    expect(protectedHeader.alg).toBe("RS256");
    expect(payload.sub).toBe(CLERK_SEED.sub);
  });

  it("okta: issues a token verifiable against the env-advertised JWKS with issuer and audience checks", async () => {
    backend = await startOAuthBackend("okta", await freePort());

    expect(backend.env.OAUTH_ISSUER).toBe(backend.baseUrl);
    expect(backend.env.OAUTH_AUDIENCE).toBe(OKTA_SEED.clientId);

    const token = await backend.getToken();
    const { payload, protectedHeader } = await jwtVerify(
      token,
      createRemoteJWKSet(new URL(backend.env.OAUTH_JWKS_URL)),
      {
        issuer: backend.env.OAUTH_ISSUER,
        audience: backend.env.OAUTH_AUDIENCE,
      }
    );
    expect(protectedHeader.alg).toBe("RS256");
    expect(payload.sub).toBe(OKTA_SEED.sub);
    expect(payload.email).toBe(OKTA_SEED.email);
  });

  it("rejects a token from one instance when verified against a fresh instance's issuer", async () => {
    // Grading runs against a fresh IdP on a different port than the agent
    // phase. The emulators share one in-process keypair, so the isolation
    // (and the hardcoded-issuer trap) rests on the issuer claim differing.
    backend = await startOAuthBackend("okta", await freePort());
    const staleToken = await backend.getToken();
    await backend.stop();

    backend = await startOAuthBackend("okta", await freePort());
    const fresh = createRemoteJWKSet(new URL(backend.env.OAUTH_JWKS_URL));
    await expect(
      jwtVerify(staleToken, fresh, { issuer: backend.env.OAUTH_ISSUER })
    ).rejects.toThrow();
  });
});
