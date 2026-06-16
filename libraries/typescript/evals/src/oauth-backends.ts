import { createServer, serve } from "@emulators/core";
import {
  clerkPlugin,
  seedFromConfig as seedClerk,
} from "@emulators/clerk";
import { oktaPlugin, seedFromConfig as seedOkta } from "@emulators/okta";

/**
 * Local IdP backends for the OAuth tasks, built on vercel-labs/emulate:
 * deterministic, seedable, in-memory reimplementations of real providers
 * (real RS256 keypairs + JWKS, standard authorization-code flow).
 *
 * One instance serves the agent phase (so the agent can inspect and probe the
 * local issuer) and a *fresh* instance serves grading (so agent-phase state
 * can't pollute checks). Both emulators issue opaque access tokens but RS256
 * JWT id_tokens; the grader presents the id_token as the bearer — the
 * contract the server under test implements (verify a JWT against the IdP's
 * JWKS with an issuer check) is the same either way.
 *
 * Clerk note: emulate's Clerk backend does not implement Dynamic Client
 * Registration. The Clerk eval therefore checks that agents use
 * oauthClerkProvider() and that the server accepts Clerk-issued JWTs; it does
 * not try to prove a complete Clerk DCR client flow.
 */
export type OAuthBackendKind = "clerk" | "okta";

export interface OAuthBackend {
  kind: OAuthBackendKind;
  baseUrl: string;
  /** env for the agent phase AND the server under test (issuer config) */
  env: Record<string, string>;
  /** headless authorization-code flow; returns a JWKS-verifiable JWT */
  getToken: () => Promise<string>;
  stop: () => Promise<void>;
}

/**
 * Deterministic seed identities. task.json `calls` expectations reference the
 * `sub` values as literals — tests assert the two stay in sync.
 */
export const CLERK_SEED = {
  sub: "user_eval2f81aa01",
  email: "eval-user@example.com",
  clientId: "eval-clerk-client",
  clientSecret: "eval-clerk-secret",
  // never actually followed — the grader reads the code off the 302 Location
  redirectUri: "http://localhost:1/callback",
} as const;

export const OKTA_SEED = {
  sub: "00ueval2f81aa01",
  email: "eval-user@example.com",
  clientId: "eval-okta-client",
  clientSecret: "eval-okta-secret",
  redirectUri: "http://localhost:1/callback",
} as const;

const START_TIMEOUT_MS = 10_000;

export async function startOAuthBackend(
  kind: OAuthBackendKind,
  port: number
): Promise<OAuthBackend> {
  const baseUrl = `http://localhost:${port}`;

  if (kind === "clerk") {
    const { app, store } = createServer(clerkPlugin, { port, baseUrl });
    seedClerk(store, baseUrl, {
      users: [
        {
          clerk_id: CLERK_SEED.sub,
          email_addresses: [CLERK_SEED.email],
          first_name: "Eval",
          last_name: "User",
        },
      ],
      oauth_applications: [
        {
          client_id: CLERK_SEED.clientId,
          client_secret: CLERK_SEED.clientSecret,
          name: "mcp-use eval",
          redirect_uris: [CLERK_SEED.redirectUri],
        },
      ],
    });
    // Real Clerk serves its JWKS at /.well-known/jwks.json (which is where
    // mcp-use's ClerkOAuthProvider looks); the emulator only has /v1/jwks.
    // Alias it on the same origin so the token `iss` still matches.
    app.get("/.well-known/jwks.json", () => app.request("/v1/jwks"));
    // oauthClerkProvider() proxies OAuth authorization-server metadata from
    // Clerk. Emulate exposes OIDC metadata but not the OAuth metadata URL, so
    // provide an alias without inventing a DCR registration_endpoint.
    app.get("/.well-known/oauth-authorization-server", () =>
      app.request("/.well-known/openid-configuration")
    );

    const server = serve({ fetch: app.fetch.bind(app), port });
    await waitForHttp(`${baseUrl}/.well-known/openid-configuration`);
    return {
      kind,
      baseUrl,
      env: { MCP_USE_OAUTH_CLERK_FRONTEND_API_URL: baseUrl },
      getToken: () =>
        authCodeIdToken({
          consentUrl: `${baseUrl}/oauth/authorize/callback`,
          tokenUrl: `${baseUrl}/oauth/token`,
          userRef: CLERK_SEED.sub,
          clientId: CLERK_SEED.clientId,
          clientSecret: CLERK_SEED.clientSecret,
          redirectUri: CLERK_SEED.redirectUri,
        }),
      stop: () => closeServer(server),
    };
  }

  const { app, store } = createServer(oktaPlugin, { port, baseUrl });
  seedOkta(store, baseUrl, {
    users: [
      {
        okta_id: OKTA_SEED.sub,
        login: OKTA_SEED.email,
        email: OKTA_SEED.email,
        first_name: "Eval",
        last_name: "User",
      },
    ],
    oauth_clients: [
      {
        client_id: OKTA_SEED.clientId,
        client_secret: OKTA_SEED.clientSecret,
        name: "mcp-use eval",
        redirect_uris: [OKTA_SEED.redirectUri],
        grant_types: ["authorization_code"],
      },
    ],
  });

  const server = serve({ fetch: app.fetch.bind(app), port });
  await waitForHttp(`${baseUrl}/.well-known/openid-configuration`);
  return {
    kind,
    baseUrl,
    // Generic names: the task frames this as a company OIDC IdP wired through
    // the SDK's custom provider. The org auth server's issuer is the base URL.
    env: {
      OAUTH_ISSUER: baseUrl,
      OAUTH_AUTH_ENDPOINT: `${baseUrl}/oauth2/v1/authorize`,
      OAUTH_TOKEN_ENDPOINT: `${baseUrl}/oauth2/v1/token`,
      OAUTH_JWKS_URL: `${baseUrl}/oauth2/v1/keys`,
      OAUTH_AUDIENCE: OKTA_SEED.clientId,
    },
    getToken: () =>
      authCodeIdToken({
        consentUrl: `${baseUrl}/oauth2/v1/authorize/callback`,
        tokenUrl: `${baseUrl}/oauth2/v1/token`,
        userRef: OKTA_SEED.sub,
        clientId: OKTA_SEED.clientId,
        clientSecret: OKTA_SEED.clientSecret,
        redirectUri: OKTA_SEED.redirectUri,
      }),
    stop: () => closeServer(server),
  };
}

/**
 * Headless authorization-code flow. Both emulators render an HTML user picker
 * whose consent step is a plain form POST, so no browser is needed: POST the
 * consent callback directly, read the code off the 302 Location, exchange it.
 * Returns the id_token: the RS256 JWT verifiable against the IdP's JWKS.
 */
async function authCodeIdToken(opts: {
  consentUrl: string;
  tokenUrl: string;
  userRef: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<string> {
  const consent = await fetch(opts.consentUrl, {
    method: "POST",
    body: new URLSearchParams({
      user_ref: opts.userRef,
      redirect_uri: opts.redirectUri,
      scope: "openid profile email",
      client_id: opts.clientId,
    }),
    redirect: "manual",
  });
  const location = consent.headers.get("location");
  if (consent.status !== 302 || !location) {
    throw new Error(
      `consent POST ${opts.consentUrl} → HTTP ${consent.status} (expected 302): ${(await consent.text()).slice(0, 300)}`
    );
  }
  const code = new URL(location).searchParams.get("code");
  if (!code) throw new Error(`no code in redirect Location: ${location}`);

  const tokenRes = await fetch(opts.tokenUrl, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: opts.redirectUri,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
    }),
  });
  const body = (await tokenRes.json()) as { id_token?: string };
  if (!tokenRes.ok || !body.id_token) {
    throw new Error(
      `token exchange ${opts.tokenUrl} → HTTP ${tokenRes.status}: ${JSON.stringify(body).slice(0, 300)}`
    );
  }
  return body.id_token;
}

async function waitForHttp(url: string): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      await res.body?.cancel();
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`OAuth backend did not come up at ${url}`);
}

function closeServer(server: {
  close: (cb?: (err?: Error) => void) => unknown;
}): Promise<void> {
  return new Promise((resolve) => {
    // closeAllConnections exists on node's http.Server; without it close()
    // waits for keep-alive sockets and can hang the trial loop.
    (
      server as unknown as { closeAllConnections?: () => void }
    ).closeAllConnections?.();
    server.close(() => resolve());
  });
}
