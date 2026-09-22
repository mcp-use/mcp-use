import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { symmetricDecrypt } from "better-auth/crypto";

import { createNativeMcpAuth } from "../src/oauth/better-auth-mcp.js";
import { firebaseIdentityAdapter } from "../examples/auth/firebase/src/auth/firebase.js";
import {
  authorize,
  OAuthBrowser,
  startBroker,
  tokens,
} from "./helpers/oauth-broker.js";

// Exercise the example against the source SDK, just like the broker tests.
vi.mock(
  "mcp-use/oauth/native-identity",
  () => import("../src/oauth/native-identity.js")
);

const originalFetch = globalThis.fetch;
let key: Awaited<ReturnType<typeof generateKeyPair>>;
let jwks: { keys: object[] };
const cleanup: Array<() => Promise<void>> = [];
beforeAll(async () => {
  key = await generateKeyPair("RS256");
  jwks = {
    keys: [
      {
        ...(await exportJWK(key.publicKey)),
        kid: "firebase-fixture",
        alg: "RS256",
        use: "sig",
      },
    ],
  };
});
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function firebaseSource() {
  const authTime = Math.floor(Date.now() / 1000);
  const config = {
    projectId: "firebase-test",
    apiKey: "fixture-web-key",
    authDomain: "firebase-test.firebaseapp.com",
    appId: "1:123:web:abc",
  };
  const state = {
    lookupFailure: 0,
    refreshFailure: 0,
    revoked: false,
    disabled: false,
    lookupUser: {} as Record<string, unknown>,
    claims: {} as JWTPayload,
    refreshes: 0,
    lookups: 0,
    refreshInputs: [] as string[],
    afterRefresh: undefined as (() => Promise<void>) | undefined,
  };
  const refreshTokens = new Set(["initial-refresh"]);
  const idTokens = new Set<string>();
  const sign = (claims: JWTPayload = {}) =>
    new SignJWT({
      sub: "firebase-user",
      auth_time: authTime,
      email: "user@example.test",
      email_verified: true,
      firebase: { sign_in_provider: "google.com" },
      aud: config.projectId,
      iss: `https://securetoken.google.com/${config.projectId}`,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...claims,
    })
      .setProtectedHeader({ alg: "RS256", kid: "firebase-fixture" })
      .sign(key.privateKey)
      .then((token) => {
        idTokens.add(token);
        return token;
      });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString()
      );
      if (url.hostname === "www.googleapis.com") return Response.json(jwks);
      if (url.hostname === "securetoken.googleapis.com") {
        state.refreshes++;
        expect(url.pathname).toBe("/v1/token");
        expect(url.searchParams.get("key")).toBe(config.apiKey);
        expect(init?.method).toBe("POST");
        const form = new URLSearchParams(String(init?.body));
        expect(form.get("grant_type")).toBe("refresh_token");
        const refreshToken = form.get("refresh_token") ?? "";
        state.refreshInputs.push(refreshToken);
        if (!refreshTokens.has(refreshToken))
          return Response.json(
            { error: { message: "INVALID_REFRESH_TOKEN" } },
            { status: 400 }
          );
        if (state.refreshFailure)
          return Response.json(
            { error: { message: "TOKEN_EXPIRED" } },
            { status: state.refreshFailure }
          );
        if (state.revoked || state.disabled)
          return Response.json(
            {
              error: {
                message: state.disabled ? "USER_DISABLED" : "TOKEN_EXPIRED",
              },
            },
            { status: 400 }
          );
        const nextRefreshToken = `rotated-${state.refreshes}`;
        // Exercise a provider that invalidates its previous token on rotation.
        refreshTokens.delete(refreshToken);
        refreshTokens.add(nextRefreshToken);
        const idToken = await sign(state.claims);
        await state.afterRefresh?.();
        return Response.json({
          id_token: idToken,
          refresh_token: nextRefreshToken,
        });
      }
      if (url.hostname === "identitytoolkit.googleapis.com") {
        state.lookups++;
        expect(url.pathname).toBe("/v1/accounts:lookup");
        expect(url.searchParams.get("key")).toBe(config.apiKey);
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body));
        if (!idTokens.has(body.idToken))
          return Response.json(
            { error: { message: "INVALID_ID_TOKEN" } },
            { status: 400 }
          );
        if (state.lookupFailure)
          return Response.json(
            { error: { message: "UPSTREAM_UNAVAILABLE" } },
            { status: state.lookupFailure }
          );
        return Response.json({
          users: [
            {
              localId: "firebase-user",
              email: "user@example.test",
              emailVerified: true,
              disabled: state.disabled,
              validSince: String(authTime + (state.revoked ? 1 : 0)),
              ...state.lookupUser,
            },
          ],
        });
      }
      return originalFetch(input, init);
    })
  );
  return {
    state,
    sign,
    config,
    authTime,
    adapter: firebaseIdentityAdapter(config),
  };
}

async function firebaseBroker() {
  const source = await firebaseSource();
  const broker = await startBroker((options) =>
    createNativeMcpAuth({
      ...options,
      sessionPolicy: "strict",
      sessionExpiresIn: 10_800,
      accessTokenExpiresIn: 7_200,
      providers: { firebase: source.adapter },
    })
  );
  cleanup.push(broker.close);
  const browser = new OAuthBrowser([broker.origin]);
  const grant = await authorize(broker, browser, async (query) => {
    const begin = await browser.request(`${broker.base}/native/start`, {
      provider: "firebase",
      oauth_query: query,
    });
    const { csrf } = await begin.json();
    return browser.request(`${broker.base}/native/sign-in`, {
      provider: "firebase",
      oauth_query: query,
      csrf,
      proof: { idToken: await source.sign(), refreshToken: "initial-refresh" },
    });
  });
  const issued = await tokens(await broker.token(grant.fields));
  const binding = async () =>
    JSON.parse(
      await symmetricDecrypt({
        key: broker.secret,
        data: String(broker.session(issued.access_token)!.nativeBinding),
      })
    );
  return { ...source, broker, issued, grant, binding };
}

function expireIdToken() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + 3_601_000);
}

describe("Firebase REST identity and strict MCP sessions", () => {
  it("saves a Firebase rotation after cancellation and retries the same MCP refresh token", async () => {
    const f = await firebaseBroker();
    const before = await f.binding();
    const refreshBefore = f.broker.refreshRows();
    let received!: () => void;
    const rotated = new Promise<void>((resolve) => {
      received = resolve;
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.state.afterRefresh = async () => {
      received();
      await held;
    };
    const controller = new AbortController();
    const pending = f.broker.integration.handle(
      new Request(`${f.broker.base}/oauth2/token`, {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: f.grant.clientId,
          refresh_token: f.issued.refresh_token,
          resource: f.broker.resource,
        }),
      })
    );
    try {
      await rotated;
      controller.abort();
      expect((await pending)!.status).toBe(503);
      expect(f.broker.refreshRows()).toEqual(refreshBefore);
    } finally {
      f.state.afterRefresh = undefined;
      release();
    }
    await vi.waitFor(() =>
      expect(
        f.broker.session(f.issued.access_token)!.nativeLeaseOwner
      ).toBeNull()
    );
    expect((await f.binding()).refreshToken).not.toBe(before.refreshToken);
    expect(f.broker.refreshRows()).toEqual(refreshBefore);
    const renewed = await tokens(
      await f.broker.token({
        grant_type: "refresh_token",
        client_id: f.grant.clientId,
        refresh_token: f.issued.refresh_token,
      })
    );
    expect((await f.broker.tool(renewed.access_token)).status).toBe(200);
  });

  it("resumes an idle user after ID-token expiry, saves the renewed binding, and checks it again", async () => {
    const f = await firebaseBroker();
    const before = await f.binding();
    const refreshes = f.state.refreshes;
    const lookups = f.state.lookups;
    expireIdToken();
    const response = await f.broker.tool(f.issued.access_token);
    expect(response.status).toBe(200);
    expect(f.broker.executions).toBe(1);
    const after = await f.binding();
    expect(after).toMatchObject({ uid: before.uid, authTime: before.authTime });
    expect(after.idToken).not.toBe(before.idToken);
    expect(after.refreshToken).not.toBe(before.refreshToken);
    expect(f.state.refreshes).toBe(refreshes + 1);
    expect(f.state.refreshInputs.at(-1)).toBe(before.refreshToken);
    expect(f.state.lookups).toBe(lookups + 1); // Strict retry after saving the renewal.
    expect((await f.broker.tool(f.issued.access_token)).status).toBe(200);
    expect(f.state.refreshes).toBe(refreshes + 1);
    expireIdToken();
    const renewed = await f.broker.token({
      grant_type: "refresh_token",
      client_id: f.grant.clientId,
      refresh_token: f.issued.refresh_token,
    });
    expect(renewed.status).toBe(200);
    expect(f.state.refreshInputs.at(-1)).toBe(after.refreshToken);
  });

  it.each([
    "disabled",
    "revoked",
    "unverified email",
    "changed email",
    "different tenant",
    "different user",
  ])(
    "rejects a still-valid ID token when account lookup reports %s",
    async (reason) => {
      const f = await firebaseBroker();
      const refreshes = f.state.refreshes;
      const lookups = f.state.lookups;
      if (reason === "disabled") f.state.disabled = true;
      if (reason === "revoked") f.state.revoked = true;
      if (reason === "unverified email")
        f.state.lookupUser.emailVerified = false;
      if (reason === "changed email")
        f.state.lookupUser.email = "other@example.test";
      if (reason === "different tenant")
        f.state.lookupUser.tenantId = "other-tenant";
      if (reason === "different user")
        f.state.lookupUser.localId = "other-user";
      expect((await f.broker.tool(f.issued.access_token)).status).toBe(401);
      expect(f.state.lookups).toBe(lookups + 1);
      expect(f.state.refreshes).toBe(refreshes);
      expect(f.broker.executions).toBe(0);
      expect(f.broker.session(f.issued.access_token)).toBeUndefined();
      f.state.disabled = false;
      f.state.revoked = false;
      f.state.lookupUser = {};
      expect(
        (
          await f.broker.token({
            grant_type: "refresh_token",
            client_id: f.grant.clientId,
            refresh_token: f.issued.refresh_token,
          })
        ).status
      ).toBe(400);
    }
  );

  it.each(["revoked", "disabled", "refresh rejected"])(
    "keeps an expired-token session rejected when Firebase reports %s",
    async (reason) => {
      const f = await firebaseBroker();
      expireIdToken();
      if (reason === "revoked") f.state.revoked = true;
      if (reason === "disabled") f.state.disabled = true;
      if (reason === "refresh rejected") f.state.refreshFailure = 400;
      expect((await f.broker.tool(f.issued.access_token)).status).toBe(401);
      expect(f.broker.session(f.issued.access_token)).toBeUndefined();
      f.state.revoked = false;
      f.state.disabled = false;
      f.state.refreshFailure = 0;
      expect((await f.broker.tool(f.issued.access_token)).status).toBe(401);
      expect(
        (
          await f.broker.token({
            grant_type: "refresh_token",
            client_id: f.grant.clientId,
            refresh_token: f.issued.refresh_token,
          })
        ).status
      ).toBe(400);
      expect(f.broker.executions).toBe(0);
    }
  );

  it("preserves credentials when the refresh endpoint is unavailable", async () => {
    const f = await firebaseBroker();
    const before = await f.binding();
    const refreshBefore = f.broker.refreshRows();
    expireIdToken();
    f.state.refreshFailure = 503;
    expect((await f.broker.tool(f.issued.access_token)).status).toBe(503);
    expect(await f.binding()).toEqual(before);
    expect(f.broker.refreshRows()).toEqual(refreshBefore);
    expect(f.broker.executions).toBe(0);
    f.state.refreshFailure = 0;
    expect((await f.broker.tool(f.issued.access_token)).status).toBe(200);
  });

  it("retains a rotated credential when the following strict account lookup fails", async () => {
    const f = await firebaseBroker();
    const before = await f.binding();
    const refreshBefore = f.broker.refreshRows();
    const refreshes = f.state.refreshes;
    expireIdToken();
    f.state.lookupFailure = 503;
    expect((await f.broker.tool(f.issued.access_token)).status).toBe(503);
    const after = await f.binding();
    expect(after.refreshToken).not.toBe(before.refreshToken);
    expect(after).toMatchObject({ uid: before.uid, authTime: before.authTime });
    expect(f.broker.refreshRows()).toEqual(refreshBefore);
    expect(f.broker.executions).toBe(0);
    f.state.lookupFailure = 0;
    expect((await f.broker.tool(f.issued.access_token)).status).toBe(200);
    expect(f.state.refreshes).toBe(refreshes + 1);
    // The old credential really is unusable; recovery used the persisted replacement.
    expect(
      await f.adapter.revalidate!(before, new AbortController().signal)
    ).toEqual({
      status: "invalid",
    });
  });

  it.each(["user", "authentication"])(
    "rejects a refresh that replaces the original %s",
    async (name) => {
      const f = await firebaseBroker();
      expireIdToken();
      f.state.claims =
        name === "user" ? { sub: "other-user" } : { auth_time: f.authTime + 1 };
      expect((await f.broker.tool(f.issued.access_token)).status).toBe(401);
      expect(f.broker.session(f.issued.access_token)).toBeUndefined();
    }
  );

  it.each([
    ["audience", { aud: "other-project" }],
    ["issuer", { iss: "https://wrong.example.test" }],
    [
      "tenant",
      { firebase: { sign_in_provider: "google.com", tenant: "other" } },
    ],
    ["provider", { firebase: { sign_in_provider: "password" } }],
    ["verified email", { email_verified: false }],
    ["authentication time", { auth_time: 0 }],
    ["expiry", { exp: 1 }],
  ])(
    "rejects a signed login with an invalid %s claim",
    async (_name, claims) => {
      const f = await firebaseSource();
      await expect(
        f.adapter.authenticate({
          request: new Request("https://mcp.example.test/login"),
          proof: {
            idToken: await f.sign(claims as JWTPayload),
            refreshToken: "fixture",
          },
        })
      ).rejects.toMatchObject({ code: "invalid" });
      expect(f.state.refreshes).toBe(0);
    }
  );

  it("aborts a cold signing-key fetch with the strict request", async () => {
    const f = await firebaseSource();
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    let fetchSignal!: AbortSignal;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: unknown, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            fetchSignal = init.signal!;
            fetchSignal.addEventListener(
              "abort",
              () => reject(new Error("cancelled")),
              { once: true }
            );
            started();
          })
      )
    );
    const controller = new AbortController();
    const pending = f.adapter.checkStatus!(
      { uid: "firebase-user", authTime: f.authTime, idToken: await f.sign() },
      controller.signal
    );
    await entered;
    controller.abort();
    expect(await pending).toBe("unavailable");
    expect(fetchSignal.aborted).toBe(true);
  });
});
