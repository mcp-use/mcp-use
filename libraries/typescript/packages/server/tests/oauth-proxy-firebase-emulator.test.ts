/**
 * OAuth proxy with the `firebase()` upstream against the Firebase Auth
 * emulator: real emulator ID tokens and refresh tokens, and real Token
 * Service refreshes. The users come from the emulator's REST API
 * (`accounts:signInWithIdp` with a JSON Google ID token), so no browser
 * runs; the proof is what the page script posts after the popup.
 *
 * Runs only under the emulator; from packages/server:
 *
 * ```sh
 * pnpm test:firebase-emulator
 * ```
 *
 * which is `firebase-tools emulators:exec --only auth --project
 * demo-mcp-use`. `emulators:exec` sets `FIREBASE_AUTH_EMULATOR_HOST`; only
 * this test reads it, never the library.
 */
import { decodeJwt, decodeProtectedHeader, UnsecuredJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MCPServer } from "../src/index.js";
import {
  firebase,
  memoryStorage,
  oauthProxy,
  type UpstreamUser,
} from "../src/oauth/index.js";
import { Browser, oauthFlow, toolText } from "./helpers/oauth-proxy-browser.js";

const HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const EMULATOR = `http://${HOST}`;
const PROJECT = "demo-mcp-use";
const API_KEY = "fake-api-key";
const ORIGIN = "http://localhost:4321";
const RESOURCE = `${ORIGIN}/mcp`;
const SECRET = "test-secret-0123456789-abcdefghijklmnop";
const CLIENT_REDIRECT = "http://127.0.0.1:53683/callback";
const TOKEN_PATH = "/securetoken.googleapis.com/v1/token";

const { register, signIn, callTool, refresh } = oauthFlow({
  resource: RESOURCE,
  redirectUri: CLIENT_REDIRECT,
});

/** The real fetch, for the test's own emulator calls. */
const realFetch = globalThis.fetch;

/** Calls the emulator's REST API and returns its JSON answer. */
async function emulator(
  path: string,
  init: RequestInit = {}
): Promise<Record<string, unknown>> {
  const response = await realFetch(`${EMULATOR}${path}`, init);
  const body = (await response.json()) as Record<string, unknown>;
  expect(response.ok, JSON.stringify(body)).toBe(true);
  return body;
}

interface EmulatorUser {
  uid: string;
  idToken: string;
  refreshToken: string;
}

/**
 * Signs a Google user in at the emulator, as the popup would. The emulator
 * takes a JSON object in place of Google's ID token.
 */
async function googleSignIn(sub: string, email: string): Promise<EmulatorUser> {
  const googleIdToken = JSON.stringify({
    sub,
    email,
    email_verified: true,
    name: "Ada Lovelace",
  });
  const body = await emulator(
    `/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestUri: "http://localhost",
        returnSecureToken: true,
        postBody: `providerId=google.com&id_token=${encodeURIComponent(
          googleIdToken
        )}`,
      }),
    }
  );
  return {
    uid: String(body["localId"]),
    idToken: String(body["idToken"]),
    refreshToken: String(body["refreshToken"]),
  };
}

/** Disables the user with the emulator's admin credentials. */
async function disableUser(uid: string): Promise<void> {
  await emulator(
    `/identitytoolkit.googleapis.com/v1/accounts:update?key=${API_KEY}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer owner",
      },
      body: JSON.stringify({ localId: uid, disableUser: true }),
    }
  );
}

/** What the page script posts after the popup. */
function proof(user: EmulatorUser): string {
  return JSON.stringify({
    idToken: user.idToken,
    refreshToken: user.refreshToken,
  });
}

/** Records the proxy's Token Service requests and their status. */
function recordTokenRequests(): { url: string; status: number }[] {
  const requests: { url: string; status: number }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const response = await realFetch(input, init);
    const url = String(input instanceof Request ? input.url : input);
    if (new URL(url).pathname === TOKEN_PATH) {
      requests.push({ url, status: response.status });
    }
    return response;
  });
  return requests;
}

interface WhoAmI {
  subject: string;
  accessToken?: string | undefined;
  expiresAt?: number | undefined;
}

function emulatorServer(): MCPServer<UpstreamUser> {
  const server = new MCPServer({
    name: "notes",
    version: "1.0.0",
    logging: { enabled: false },
    oauth: oauthProxy({
      resource: RESOURCE,
      upstream: firebase({
        apiKey: API_KEY,
        authDomain: `${PROJECT}.firebaseapp.com`,
        projectId: PROJECT,
        providers: ["google.com"],
        emulator: { url: EMULATOR },
      }),
      secret: SECRET,
      storage: memoryStorage(),
      // Outlives the clock jumps below, so only the upstream expires.
      accessTokenTtl: 7 * 24 * 60 * 60,
    }),
  });
  server.tool({ name: "whoami" }, async (_input, ctx) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify({
          subject: ctx.auth.user.subject,
          accessToken: ctx.auth.upstream?.accessToken,
          expiresAt: ctx.auth.upstream?.expiresAt,
        } satisfies WhoAmI),
      },
    ],
  }));
  return server;
}

async function whoami(browser: Browser, accessToken: string): Promise<WhoAmI> {
  return JSON.parse(
    await toolText(await callTool(browser, "whoami", accessToken))
  ) as WhoAmI;
}

/** Moves the clock past the lifetime of an emulator ID token. */
function advanceOneHour(): void {
  vi.setSystemTime(Date.now() + 61 * 60 * 1000);
}

describe.skipIf(!HOST)("firebase() with the Firebase Auth emulator", () => {
  beforeEach(async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await emulator(`/emulator/v1/projects/${PROJECT}/accounts`, {
      method: "DELETE",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("signs in with an emulator ID token and refreshes it", async () => {
    const tokenRequests = recordTokenRequests();
    const server = emulatorServer();
    const browser = new Browser(server);
    const client = await register(browser);
    const user = await googleSignIn("google-ada-1", "ada@example.com");

    const tokens = await signIn(browser, client, proof(user));
    const first = await whoami(browser, tokens.access_token!);
    expect(first.subject).toBe(user.uid);
    expect(first.accessToken).toBe(user.idToken);
    expect(tokenRequests).toEqual([]);

    // The emulator's token is unsigned and names the project and the user.
    const decoded = UnsecuredJWT.decode(first.accessToken!, {
      issuer: `https://securetoken.google.com/${PROJECT}`,
      audience: PROJECT,
    });
    expect(decoded.payload.sub).toBe(user.uid);

    // An hour later the ID token expired: the proxy refreshes it at the
    // emulator's Token Service before the tool runs.
    vi.useFakeTimers({ toFake: ["Date"] });
    advanceOneHour();
    const second = await whoami(browser, tokens.access_token!);
    expect(tokenRequests).toEqual([
      {
        url: `${EMULATOR}${TOKEN_PATH}?key=${API_KEY}`,
        status: 200,
      },
    ]);
    expect(second.subject).toBe(user.uid);
    expect(second.expiresAt).toBeGreaterThan(first.expiresAt!);
    expect(second.expiresAt! * 1000).toBeGreaterThan(Date.now());
    // The emulator issued it on the real clock, an hour behind this one.
    expect(decodeProtectedHeader(second.accessToken!).alg).toBe("none");
    expect(decodeJwt(second.accessToken!)).toMatchObject({
      aud: PROJECT,
      sub: user.uid,
    });
  });

  it("ends the grant when the emulator reports USER_DISABLED", async () => {
    const tokenRequests = recordTokenRequests();
    const server = emulatorServer();
    const browser = new Browser(server);
    const client = await register(browser);
    const user = await googleSignIn("google-ada-2", "ada@example.com");
    const tokens = await signIn(browser, client, proof(user));
    expect((await whoami(browser, tokens.access_token!)).subject).toBe(
      user.uid
    );

    // Disabling the user changes nothing until the ID token is refreshed:
    // the proxy checks ID tokens offline.
    await disableUser(user.uid);
    expect((await whoami(browser, tokens.access_token!)).subject).toBe(
      user.uid
    );

    vi.useFakeTimers({ toFake: ["Date"] });
    advanceOneHour();
    const denied = await callTool(browser, "whoami", tokens.access_token!);
    expect(denied.status).toBe(401);
    expect(tokenRequests.map((request) => request.status)).toEqual([400]);
    expect(
      String(
        vi
          .mocked(console.warn)
          .mock.calls.map((call) => call.join(" "))
          .join("\n")
      )
    ).toContain("USER_DISABLED");

    // The MCP refresh token ended with the grant.
    const refreshed = await refresh(browser, client, tokens.refresh_token!);
    expect(refreshed.body.error).toBe("invalid_grant");
    expect(tokenRequests).toHaveLength(1);
  });
});
