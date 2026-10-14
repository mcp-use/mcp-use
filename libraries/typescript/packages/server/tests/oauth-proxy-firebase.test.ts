/**
 * OAuth proxy with the `firebase()` upstream, against stub Firebase
 * endpoints: RS256 keys made here, the JWK set and the Token Service API
 * served through the proxy's `fetch` option. A fetch-based browser posts
 * the consent form with the proof that the page script would post after
 * the sign-in popup.
 */
import {
  exportJWK,
  generateKeyPair,
  SignJWT,
  UnsecuredJWT,
  type JWK,
  type JWTPayload,
} from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { MCPServer } from "../src/index.js";
import {
  firebase,
  memoryStorage,
  oauthProxy,
  upstreamToken,
  type FirebaseUpstreamOptions,
  type OAuthProxyOptions,
  type UpstreamUser,
} from "../src/oauth/index.js";
import {
  Browser,
  oauthFlow,
  toolText,
  type TokenResponse,
} from "./helpers/oauth-proxy-browser.js";

const ORIGIN = "http://localhost:4320";
const RESOURCE = `${ORIGIN}/mcp`;
const SECRET = "test-secret-0123456789-abcdefghijklmnop";
const CLIENT_REDIRECT = "http://127.0.0.1:53682/callback";
const PROJECT = "notes-mcp";
const API_KEY = "AIzaSy-test-web-key";
const AUTH_DOMAIN = "notes-mcp.firebaseapp.com";
const UID = "uid-ada-1";
const KID = "key-1";
const JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const TOKEN_URL = "https://securetoken.googleapis.com/v1/token";

let privateKey: CryptoKey;
let publicJwk: JWK;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey;
  publicJwk = {
    ...(await exportJWK(pair.publicKey)),
    kid: KID,
    alg: "RS256",
    use: "sig",
  };
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─── Stub Firebase ───────────────────────────────────────────────────────

function now(): number {
  return Math.floor(Date.now() / 1000);
}

/** Claims of a Google sign-in that just happened. */
function claims(overrides: Record<string, unknown> = {}): JWTPayload {
  const issued = now();
  const payload: Record<string, unknown> = {
    iss: `https://securetoken.google.com/${PROJECT}`,
    aud: PROJECT,
    sub: UID,
    user_id: UID,
    iat: issued,
    exp: issued + 3600,
    auth_time: issued - 5,
    email: "ada@example.com",
    email_verified: true,
    name: "Ada",
    firebase: {
      sign_in_provider: "google.com",
      identities: { email: ["ada@example.com"] },
    },
    ...overrides,
  };
  for (const [name, value] of Object.entries(payload)) {
    if (value === undefined) delete payload[name];
  }
  return payload as JWTPayload;
}

/** A Firebase ID token signed with the stub key. */
function idToken(overrides: Record<string, unknown> = {}): Promise<string> {
  return new SignJWT(claims(overrides))
    .setProtectedHeader({ alg: "RS256", kid: KID, typ: "JWT" })
    .sign(privateKey);
}

/** What the page script posts after the popup. */
function proof(token: string, refreshToken = "firebase-refresh-1"): string {
  return JSON.stringify({ idToken: token, refreshToken });
}

/** Stub googleapis: the JWK set and the Token Service API. */
class FirebaseStub {
  jwksRequests = 0;
  readonly refreshes: { url: string; body: URLSearchParams }[] = [];
  /** Answers the next Token Service requests; the default issues a token. */
  answer: (body: URLSearchParams) => Response | Promise<Response> = async (
    body
  ) =>
    Response.json({
      id_token: await idToken({ auth_time: now() - 7200 }),
      refresh_token: `${body.get("refresh_token")}-next`,
      expires_in: "3600",
      token_type: "Bearer",
      user_id: UID,
    });

  readonly fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === JWKS_URL) {
      this.jwksRequests++;
      return Response.json(
        { keys: [publicJwk] },
        { headers: { "cache-control": "public, max-age=22656" } }
      );
    }
    if (url.split("?")[0]!.endsWith("/securetoken.googleapis.com/v1/token")) {
      const body = new URLSearchParams(String(init?.body ?? ""));
      this.refreshes.push({ url, body });
      return this.answer(body);
    }
    throw new Error(`unexpected request to ${url}`);
  };
}

function tokenError(message: string, status = 400): Response {
  return Response.json(
    { error: { code: status, message, errors: [] } },
    { status }
  );
}

// ─── Harness ─────────────────────────────────────────────────────────────

const { register, openConsent, allow, exchange, signIn, callTool } = oauthFlow({
  resource: RESOURCE,
  redirectUri: CLIENT_REDIRECT,
});

function firebaseOptions(
  overrides: Partial<FirebaseUpstreamOptions> = {}
): FirebaseUpstreamOptions {
  return {
    apiKey: API_KEY,
    authDomain: AUTH_DOMAIN,
    projectId: PROJECT,
    ...overrides,
  };
}

function firebaseServer(
  stub: FirebaseStub,
  upstreamOverrides: Partial<FirebaseUpstreamOptions> = {},
  overrides: Partial<OAuthProxyOptions<UpstreamUser>> = {}
): MCPServer<UpstreamUser> {
  const server = new MCPServer({
    name: "notes",
    version: "1.0.0",
    logging: { enabled: false },
    oauth: oauthProxy({
      resource: RESOURCE,
      upstream: firebase(firebaseOptions(upstreamOverrides)),
      secret: SECRET,
      storage: memoryStorage(),
      fetch: stub.fetch,
      // Long enough to outlive the clock jumps below.
      accessTokenTtl: 7 * 24 * 60 * 60,
      ...overrides,
    }),
  });
  server.tool({ name: "whoami" }, async (_input, ctx) => ({
    content: [
      {
        type: "text",
        text: `${ctx.auth.user.subject} ${upstreamToken(ctx)}`,
      },
    ],
  }));
  return server;
}

// ─── verify ──────────────────────────────────────────────────────────────

describe("firebase() verify", () => {
  const verify = (
    posted: string,
    stub = new FirebaseStub(),
    overrides: Partial<FirebaseUpstreamOptions> = {}
  ) => firebase(firebaseOptions(overrides)).verify(posted, stub);

  it("accepts a fresh ID token of the project and keeps both tokens", async () => {
    const stub = new FirebaseStub();
    const token = await idToken();
    const result = await verify(proof(token), stub);
    expect(result.user.subject).toBe(UID);
    expect(result.user.profile).toEqual({
      uid: UID,
      email: "ada@example.com",
      email_verified: true,
      name: "Ada",
      sign_in_provider: "google.com",
    });
    expect(result.tokens).toMatchObject({
      accessToken: token,
      idToken: token,
      refreshToken: "firebase-refresh-1",
      scopes: [],
    });
    expect(result.tokens!.expiresAt).toBeGreaterThan(now() + 3500);
  });

  it("caches the signing keys for the max-age of their response", async () => {
    const stub = new FirebaseStub();
    const upstream = firebase(firebaseOptions());
    await upstream.verify(proof(await idToken()), stub);
    await upstream.verify(proof(await idToken()), stub);
    expect(stub.jwksRequests).toBe(1);
  });

  it("refuses a token for another project (aud)", async () => {
    await expect(
      verify(proof(await idToken({ aud: "other-project" })))
    ).rejects.toThrow("the aud claim is not valid");
  });

  it("refuses a token from another issuer", async () => {
    await expect(
      verify(
        proof(
          await idToken({ iss: "https://securetoken.google.com/other-project" })
        )
      )
    ).rejects.toThrow("the iss claim is not valid");
  });

  it("refuses a sign-in older than maxAuthAge", async () => {
    await expect(
      verify(proof(await idToken({ auth_time: now() - 301 })))
    ).rejects.toThrow("older than 300 seconds");
    await expect(
      verify(proof(await idToken({ auth_time: now() - 500 })), undefined, {
        maxAuthAge: 600,
      })
    ).resolves.toBeDefined();
    await expect(
      verify(proof(await idToken({ auth_time: undefined })))
    ).rejects.toThrow("auth_time");
  });

  it("refuses a provider that is not in providers", async () => {
    const github = await idToken({
      firebase: { sign_in_provider: "github.com" },
    });
    await expect(verify(proof(github))).rejects.toThrow(
      "sign-in provider github.com is not allowed"
    );
    await expect(
      verify(proof(github), undefined, {
        providers: ["google.com", "github.com"],
      })
    ).resolves.toBeDefined();
    await expect(
      verify(
        proof(await idToken({ firebase: { sign_in_provider: "password" } }))
      )
    ).rejects.toThrow("sign-in provider password is not allowed");
  });

  it("refuses an unverified email when requireVerifiedEmail is set", async () => {
    const unverified = await idToken({ email_verified: false });
    await expect(
      verify(proof(unverified), undefined, { requireVerifiedEmail: true })
    ).rejects.toThrow("the email address is not verified");
    await expect(verify(proof(unverified))).resolves.toBeDefined();
  });

  it("checks the tenant", async () => {
    const tenantUser = await idToken({
      firebase: { sign_in_provider: "google.com", tenant: "tenant-a" },
    });
    await expect(verify(proof(tenantUser))).rejects.toThrow(
      "belongs to a tenant"
    );
    await expect(
      verify(proof(tenantUser), undefined, { tenantId: "tenant-b" })
    ).rejects.toThrow("belongs to another tenant");
    const result = await verify(proof(tenantUser), undefined, {
      tenantId: "tenant-a",
    });
    expect(result.user.profile["tenant"]).toBe("tenant-a");
    await expect(
      verify(proof(await idToken()), undefined, { tenantId: "tenant-a" })
    ).rejects.toThrow("belongs to another tenant");
  });

  it("refuses an alg none token", async () => {
    const unsigned = new UnsecuredJWT(claims()).encode();
    await expect(verify(proof(unsigned))).rejects.toThrow(
      "Firebase ID token refused"
    );
  });

  it("refuses a token signed with another key", async () => {
    const other = await generateKeyPair("RS256");
    const forged = await new SignJWT(claims())
      .setProtectedHeader({ alg: "RS256", kid: KID })
      .sign(other.privateKey);
    await expect(verify(proof(forged))).rejects.toThrow(
      "Firebase ID token refused"
    );
  });

  it("refuses proofs that are not a posted sign-in", async () => {
    await expect(verify("")).rejects.toThrow("no Firebase sign-in");
    await expect(verify("not json")).rejects.toThrow("not JSON");
    await expect(verify(JSON.stringify({ refreshToken: "x" }))).rejects.toThrow(
      "no ID token"
    );
    await expect(verify("x".repeat(20_000))).rejects.toThrow("too large");
  });
});

// ─── Sign-in flow ────────────────────────────────────────────────────────

describe("oauthProxy with firebase()", () => {
  it("signs in through the consent page and gives tools the ID token", async () => {
    const stub = new FirebaseStub();
    const server = firebaseServer(stub);
    const browser = new Browser(server);
    const client = await register(browser);
    const page = await openConsent(browser, client);

    const csp = page.response.headers.get("content-security-policy")!;
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(csp).toContain(
      `script-src 'nonce-${nonce}' https://www.gstatic.com https://apis.google.com`
    );
    expect(csp).toContain(
      "connect-src https://identitytoolkit.googleapis.com https://securetoken.googleapis.com;"
    );
    expect(csp).toContain(`frame-src https://${AUTH_DOMAIN};`);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("form-action");
    expect(page.response.headers.get("cross-origin-opener-policy")).toBeNull();
    expect(page.response.headers.get("x-frame-options")).toBe("DENY");

    // The consent page, then the script, inside the body.
    expect(page.html).toContain('name="decision" value="allow"');
    expect(page.html).toContain('name="decision" value="deny"');
    // The Firebase token passes through this page, so the copy does not
    // claim that it stays on the server.
    expect(page.html).toContain("The app can then use localhost:4320 as you.");
    expect(page.html).not.toContain("stay on the server");
    expect(page.html).toContain(`<script type="module" nonce="${nonce}">`);
    expect(page.html).toContain(
      "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js"
    );
    expect(page.html).toContain(`"apiKey":"${API_KEY}"`);
    expect(page.html.indexOf("<script")).toBeLessThan(
      page.html.indexOf("</body>")
    );

    const token = await idToken();
    const location = await allow(browser, page, proof(token));
    const code = location.searchParams.get("code")!;
    const tokens = await exchange(browser, client, code, page.verifier);
    expect(tokens.status).toBe(200);
    expect(
      await toolText(
        await callTool(browser, "whoami", tokens.body.access_token!)
      )
    ).toBe(`${UID} ${token}`);
    expect(stub.refreshes).toHaveLength(0);
  });

  it("returns access_denied to the client when the token is refused", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const server = firebaseServer(new FirebaseStub());
    const browser = new Browser(server);
    const client = await register(browser);
    const page = await openConsent(browser, client);
    const location = await allow(
      browser,
      page,
      proof(await idToken({ auth_time: now() - 3600 }))
    );
    expect(location.searchParams.get("code")).toBeNull();
    expect(location.searchParams.get("error")).toBe("access_denied");
    expect(location.searchParams.get("error_description")).toContain(
      "older than 300 seconds"
    );
    expect(String(error.mock.calls[0]?.join(" "))).toContain(
      "Firebase ID token refused"
    );
  });

  it("returns access_denied when the user denies, without a proof", async () => {
    const server = firebaseServer(new FirebaseStub());
    const browser = new Browser(server);
    const client = await register(browser);
    const page = await openConsent(browser, client);
    const answer = await browser.form(page.action, {
      ...page.fields,
      decision: "deny",
    });
    const location = new URL(answer.headers.get("location")!);
    expect(location.searchParams.get("error")).toBe("access_denied");
  });

  it("refuses a second POST with the same CSRF value", async () => {
    const server = firebaseServer(new FirebaseStub());
    const browser = new Browser(server);
    const client = await register(browser);
    const page = await openConsent(browser, client);
    const cookie = browser.cookieHeader();
    const posted = proof(await idToken());
    await allow(browser, page, posted);

    // The browser dropped the single-use cookie.
    const again = await browser.form(page.action, {
      ...page.fields,
      decision: "allow",
      proof: posted,
    });
    expect(again.status).toBe(403);
    // A copy of the cookie finds the sign-in already finished.
    const replay = await browser.form(
      page.action,
      { ...page.fields, decision: "allow", proof: posted },
      { cookie }
    );
    expect(replay.status).toBe(400);
    expect(replay.headers.get("location")).toBeNull();
  });

  it("shows a page with only the sign-in button when consent is skipped", async () => {
    const server = firebaseServer(new FirebaseStub(), {}, { consent: false });
    const browser = new Browser(server);
    const client = await register(browser);
    const page = await openConsent(browser, client);
    expect(page.html).toContain("Continue with Firebase");
    expect(page.html).not.toContain('value="deny"');
    expect(page.html).toContain('<script type="module"');
    const location = await allow(browser, page, proof(await idToken()));
    expect(location.searchParams.get("code")).toBeTruthy();
  });

  it("gives a custom consent page the nonce and the consent flag", async () => {
    const { createElement } = await import("react");
    const seen: unknown[] = [];
    const server = firebaseServer(
      new FirebaseStub(),
      {},
      {
        consent: {
          page: (props) => {
            seen.push(props);
            return createElement(
              "html",
              null,
              createElement(
                "body",
                null,
                createElement(
                  "form",
                  { method: "post", action: props.form.action },
                  createElement("input", {
                    type: "hidden",
                    name: "csrf",
                    value: props.form.csrf,
                  }),
                  createElement(
                    "button",
                    { name: "decision", value: "allow" },
                    "Sign in"
                  )
                )
              )
            );
          },
        },
      }
    );
    const browser = new Browser(server);
    const client = await register(browser);
    const page = await openConsent(browser, client);
    expect(seen[0]).toMatchObject({ consent: true, upstream: "Firebase" });
    const nonce = (seen[0] as { nonce: string }).nonce;
    expect(page.response.headers.get("content-security-policy")).toContain(
      `'nonce-${nonce}'`
    );
    expect(page.html).toMatch(/<\/form><script type="module"[^]*<\/body>/);
    const location = await allow(browser, page, proof(await idToken()));
    expect(location.searchParams.get("code")).toBeTruthy();
  });

  it("answers the upstream callback with an error page", async () => {
    const server = firebaseServer(new FirebaseStub());
    const response = await server.fetch(
      new Request(`${RESOURCE}/oauth/callback?state=x&code=y`)
    );
    expect(response.status).toBe(400);
  });

  it("keeps two servers with one store and one secret apart", async () => {
    const stub = new FirebaseStub();
    const storage = memoryStorage();
    const otherResource = "http://localhost:4321/mcp";
    const other = oauthFlow({
      resource: otherResource,
      redirectUri: CLIENT_REDIRECT,
    });
    const serverA = firebaseServer(stub, {}, { storage });
    const serverB = firebaseServer(
      stub,
      {},
      { storage, resource: otherResource }
    );
    const browserA = new Browser(serverA);
    const browserB = new Browser(serverB);

    // The same user signs in to both, with a different ID token for each.
    const tokenA = await idToken({ server: "a" });
    const tokenB = await idToken({ server: "b" });
    const signedInA = await signIn(
      browserA,
      await register(browserA),
      proof(tokenA)
    );
    const signedInB = await other.signIn(
      browserB,
      await other.register(browserB),
      proof(tokenB)
    );

    // Each server's tools get the upstream token of their own sign-in.
    expect(
      await toolText(
        await callTool(browserA, "whoami", signedInA.access_token!)
      )
    ).toBe(`${UID} ${tokenA}`);
    expect(
      await toolText(
        await other.callTool(browserB, "whoami", signedInB.access_token!)
      )
    ).toBe(`${UID} ${tokenB}`);

    // An access token of one server is not valid at the other.
    const crossed = await other.callTool(
      browserB,
      "whoami",
      signedInA.access_token!
    );
    expect(crossed.status).toBe(401);
  });
});

// ─── Refresh ─────────────────────────────────────────────────────────────

describe("firebase() refresh", () => {
  it("refreshes the ID token through the Token Service API", async () => {
    const stub = new FirebaseStub();
    const server = firebaseServer(stub);
    const browser = new Browser(server);
    const client = await register(browser);
    // Expires within the refresh margin: the code exchange refreshes it.
    const first = await idToken({ exp: now() + 30 });
    const tokens = await signIn(browser, client, proof(first, "rt-1"));
    expect(stub.refreshes).toHaveLength(1);
    const request = stub.refreshes[0]!;
    expect(request.url).toBe(`${TOKEN_URL}?key=${API_KEY}`);
    expect(request.body.get("grant_type")).toBe("refresh_token");
    expect(request.body.get("refresh_token")).toBe("rt-1");

    const text = await toolText(
      await callTool(browser, "whoami", tokens.access_token!)
    );
    expect(text.startsWith(`${UID} `)).toBe(true);
    expect(text).not.toContain(first);

    // An hour later, the stored refresh token from the response is used.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 2 * 3600 * 1000);
    await toolText(await callTool(browser, "whoami", tokens.access_token!));
    expect(stub.refreshes[1]!.body.get("refresh_token")).toBe("rt-1-next");
  });

  it("ends all grants on TOKEN_EXPIRED", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stub = new FirebaseStub();
    const server = firebaseServer(stub);
    const browser = new Browser(server);
    const first = await register(browser);
    const second = await register(browser);
    const a = await signIn(browser, first, proof(await idToken()));
    const b = await signIn(browser, second, proof(await idToken()));

    stub.answer = async () => tokenError("TOKEN_EXPIRED");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 2 * 3600 * 1000);
    expect((await callTool(browser, "whoami", a.access_token!)).status).toBe(
      401
    );
    // The other client's grant of the same user ended with it.
    expect((await callTool(browser, "whoami", b.access_token!)).status).toBe(
      401
    );
    const refreshed = await browser.form(`${RESOURCE}/oauth/token`, {
      grant_type: "refresh_token",
      refresh_token: b.refresh_token!,
      client_id: second.clientId,
    });
    expect(((await refreshed.json()) as TokenResponse).error).toBe(
      "invalid_grant"
    );
    expect(stub.refreshes).toHaveLength(1);
    expect(String(warn.mock.calls[0]?.join(" "))).toContain("TOKEN_EXPIRED");
  });

  it("keeps the grant on a 503 from securetoken", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const stub = new FirebaseStub();
    const healthy = stub.answer;
    stub.answer = async () => tokenError("BACKEND_ERROR", 503);
    const server = firebaseServer(stub);
    const browser = new Browser(server);
    const client = await register(browser);
    // Due for a refresh, but still valid: the failed refresh keeps it.
    const first = await idToken({ exp: now() + 30 });
    const tokens = await signIn(browser, client, proof(first));
    expect(
      await toolText(await callTool(browser, "whoami", tokens.access_token!))
    ).toBe(`${UID} ${first}`);
    expect(String(error.mock.calls.at(-1)?.join(" "))).toContain(
      "BACKEND_ERROR"
    );

    // An "API key not valid" message is no revocation either.
    stub.answer = async () =>
      tokenError("API key not valid. Please pass a valid API key.");
    expect(
      (await callTool(browser, "whoami", tokens.access_token!)).status
    ).toBe(200);

    stub.answer = healthy;
    const text = await toolText(
      await callTool(browser, "whoami", tokens.access_token!)
    );
    expect(text).not.toContain(first);
  });
});

// ─── Options ─────────────────────────────────────────────────────────────

describe("firebase() options", () => {
  it("validates its options", () => {
    expect(() =>
      firebase(firebaseOptions({ authDomain: `https://${AUTH_DOMAIN}` }))
    ).toThrow("without https://");
    expect(() => firebase(firebaseOptions({ apiKey: "" }))).toThrow(
      "firebase apiKey must be a non-empty string"
    );
    expect(() => firebase(firebaseOptions({ providers: [] }))).toThrow(
      "non-empty array"
    );
    expect(() =>
      firebase(firebaseOptions({ providers: ["password"] }))
    ).toThrow("has no sign-in popup");
    expect(() => firebase(firebaseOptions({ maxAuthAge: 0 }))).toThrow(
      "maxAuthAge"
    );
  });

  it("needs no project settings inside mcp-use build", () => {
    // What `mcp-use build` sets while it evaluates the entry.
    vi.stubEnv("MCP_USE_PHASE", "build");
    try {
      // A build with none of the runtime environment set, as in CI.
      const unset = process.env["MCP_USE_TEST_UNSET"]!;
      expect(() =>
        firebase({ apiKey: unset, authDomain: unset, projectId: unset })
      ).not.toThrow();
      expect(() =>
        firebase({ apiKey: "", authDomain: "", projectId: "" })
      ).not.toThrow();
      // Mistakes that no environment fixes still fail the build.
      expect(() =>
        firebase(firebaseOptions({ authDomain: `https://${AUTH_DOMAIN}` }))
      ).toThrow("without https://");
    } finally {
      vi.unstubAllEnvs();
    }
    expect(() =>
      firebase(firebaseOptions({ apiKey: process.env["MCP_USE_TEST_UNSET"]! }))
    ).toThrow("firebase apiKey must be a non-empty string");
  });
});
