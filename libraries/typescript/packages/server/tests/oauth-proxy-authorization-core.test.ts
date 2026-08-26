import { afterEach, describe, expect, it, vi } from "vitest";

import {
  OAuthAuthorizationCore,
  type CreateUpstreamGrantInput,
} from "../src/oauth/proxy/authorization-core.js";
import type { OAuthAuthorizationCoreError } from "../src/oauth/proxy/authorization-core.js";
import {
  resolveOAuthProxyStore,
  type OAuthProxyStore,
  type OAuthProxyStoreTransaction,
} from "../src/oauth/proxy/store.js";

const redirectUri = "https://client.example.test/callback";
const resource = "https://mcp.example.test/mcp";
const clientId = "local-client";
const verifier = "v".repeat(43);

afterEach(() => {
  vi.useRealTimers();
});

async function s256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return Buffer.from(digest).toString("base64url");
}

function createCore(
  options: ConstructorParameters<typeof OAuthAuthorizationCore>[0] = {
    store: resolveOAuthProxyStore().store,
  }
): OAuthAuthorizationCore {
  return new OAuthAuthorizationCore(options);
}

function upstreamGrant(
  overrides: Partial<CreateUpstreamGrantInput> = {}
): CreateUpstreamGrantInput {
  return {
    tokens: {
      accessToken: "upstream-access-secret",
      refreshToken: "upstream-refresh-secret",
      tokenType: "Bearer",
      accessTokenExpiresAt: Date.now() + 60 * 60 * 1000,
      scope: "read write",
    },
    userPayload: { sub: "user-1", roles: ["developer"] },
    ...overrides,
  };
}

async function issueCode(core: OAuthAuthorizationCore) {
  return core.persistGrantAndIssueAuthorizationCode({
    clientId,
    redirectUri,
    resource,
    scopes: ["read", "write"],
    codeChallenge: await s256(verifier),
    grant: upstreamGrant(),
  });
}

async function issueTokens(core: OAuthAuthorizationCore) {
  const issued = await issueCode(core);
  return core.exchangeAuthorizationCode({
    code: issued.code,
    clientId,
    redirectUri,
    resource,
    codeVerifier: verifier,
  });
}

async function expectCoreError(
  promise: Promise<unknown>,
  code: OAuthAuthorizationCoreError["code"]
): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    name: "OAuthAuthorizationCoreError",
    code,
  });
}

describe("OAuthAuthorizationCore", () => {
  it("creates and reads unique local public-client registrations", async () => {
    const core = createCore();
    const first = await core.registerClient({
      redirectUris: [redirectUri],
      clientName: "Test MCP Client",
      scope: "read write",
    });
    const second = await core.registerClient({ redirectUris: [redirectUri] });

    expect(first.clientId).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(second.clientId).not.toBe(first.clientId);
    await expect(core.getClient(first.clientId)).resolves.toEqual(first);
    await expect(core.getClient("x".repeat(43))).resolves.toBeUndefined();
  });

  it("one-time consumes browser consent with CSRF and browser binding", async () => {
    const core = createCore();
    const created = await core.createConsentTransaction({
      clientId,
      redirectUri,
      resource,
      scopes: ["read"],
      downstreamState: "downstream-state",
      codeChallenge: await s256(verifier),
      browserBinding: "b".repeat(43),
    });

    await expectCoreError(
      core.consumeConsentTransaction({
        transactionId: created.transactionId,
        csrfToken: "c".repeat(43),
        browserBinding: "b".repeat(43),
      }),
      "invalid_grant"
    );
    const consumed = await core.consumeConsentTransaction({
      transactionId: created.transactionId,
      csrfToken: created.csrfToken,
      browserBinding: "b".repeat(43),
    });
    expect(consumed.clientId).toBe(clientId);
    await expectCoreError(
      core.consumeConsentTransaction({
        transactionId: created.transactionId,
        csrfToken: created.csrfToken,
        browserBinding: "b".repeat(43),
      }),
      "invalid_grant"
    );
  });

  it("one-time consumes upstream callback state with its browser binding", async () => {
    const core = createCore();
    const created = await core.createUpstreamCallbackTransaction({
      upstreamState: "s".repeat(43),
      clientId,
      redirectUri,
      resource,
      scopes: ["read"],
      downstreamState: "downstream-state",
      downstreamCodeChallenge: await s256(verifier),
      browserBinding: "b".repeat(43),
      upstreamCodeVerifier: "u".repeat(43),
      upstreamRedirectUri: "https://mcp.example.test/oauth/callback",
      upstreamNonce: "nonce",
    });
    expect(created.state).toBe("s".repeat(43));

    await expectCoreError(
      core.consumeUpstreamCallbackTransaction({
        state: created.state,
        browserBinding: "z".repeat(43),
      }),
      "invalid_grant"
    );
    const consumed = await core.consumeUpstreamCallbackTransaction({
      state: created.state,
      browserBinding: "b".repeat(43),
    });
    expect(consumed.upstreamCodeVerifier).toBe("u".repeat(43));
    await expectCoreError(
      core.consumeUpstreamCallbackTransaction({
        state: created.state,
        browserBinding: "b".repeat(43),
      }),
      "invalid_grant"
    );
  });

  it("binds code exchange to client, redirect, resource, and S256 PKCE", async () => {
    const core = createCore();
    const issued = await issueCode(core);

    for (const override of [
      { clientId: "other-client" },
      { redirectUri: "https://client.example.test/other" },
      { resource: "https://other.example.test/mcp" },
      { codeVerifier: "x".repeat(43) },
    ]) {
      await expectCoreError(
        core.exchangeAuthorizationCode({
          code: issued.code,
          clientId,
          redirectUri,
          resource,
          codeVerifier: verifier,
          ...override,
        }),
        "invalid_grant"
      );
    }

    const tokens = await core.exchangeAuthorizationCode({
      code: issued.code,
      clientId,
      redirectUri,
      resource,
      codeVerifier: verifier,
    });
    expect(tokens).toMatchObject({
      tokenType: "Bearer",
      scope: "read write",
    });
    expect(tokens.accessToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(tokens.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);

    await expectCoreError(
      core.exchangeAuthorizationCode({
        code: issued.code,
        clientId,
        redirectUri,
        resource,
        codeVerifier: verifier,
      }),
      "invalid_grant"
    );
  });

  it("validates exact resource, family state, and encrypted upstream identity", async () => {
    const core = createCore();
    const tokens = await issueTokens(core);

    await expectCoreError(
      core.validateAccessToken(
        tokens.accessToken,
        "https://other.example.test/mcp"
      ),
      "invalid_token"
    );
    await expect(
      core.validateAccessToken(tokens.accessToken, resource)
    ).resolves.toMatchObject({
      clientId,
      resource,
      scopes: ["read", "write"],
      userPayload: { sub: "user-1", roles: ["developer"] },
      providerAccessToken: "upstream-access-secret",
      providerTokenType: "Bearer",
    });
    const validated = await core.validateAccessToken(
      tokens.accessToken,
      resource
    );
    expect(validated).not.toHaveProperty("upstreamTokens");
    expect(validated).not.toHaveProperty("refreshToken");
    expect(validated).not.toHaveProperty("idToken");
  });

  it("rotates refresh tokens and revokes the whole family on replay", async () => {
    const core = createCore();
    const first = await issueTokens(core);
    const second = await core.rotateRefreshToken({
      refreshToken: first.refreshToken,
      clientId,
      resource,
    });
    expect(second.refreshToken).not.toBe(first.refreshToken);
    await expect(
      core.validateAccessToken(second.accessToken, resource)
    ).resolves.toMatchObject({ clientId });

    await expectCoreError(
      core.rotateRefreshToken({
        refreshToken: first.refreshToken,
        clientId,
        resource,
      }),
      "invalid_grant"
    );
    await expectCoreError(
      core.validateAccessToken(second.accessToken, resource),
      "invalid_token"
    );
    await expectCoreError(
      core.rotateRefreshToken({
        refreshToken: second.refreshToken,
        clientId,
        resource,
      }),
      "invalid_grant"
    );
  });

  it("serializes concurrent refreshes and treats the loser as replay", async () => {
    const core = createCore();
    const first = await issueTokens(core);
    const results = await Promise.allSettled([
      core.rotateRefreshToken({
        refreshToken: first.refreshToken,
        clientId,
        resource,
      }),
      core.rotateRefreshToken({
        refreshToken: first.refreshToken,
        clientId,
        resource,
      }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected")
    ).toHaveLength(1);
    const winner = results.find(
      (
        result
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof issueTokens>>
      > => result.status === "fulfilled"
    );
    expect(winner).toBeDefined();
    await expectCoreError(
      core.validateAccessToken(winner!.value.accessToken, resource),
      "invalid_token"
    );
  });

  it("supports a two-phase upstream refresh success without retrying the old handle", async () => {
    const core = createCore();
    const first = await issueTokens(core);
    const begun = await core.beginUpstreamRefresh({
      refreshToken: first.refreshToken,
      clientId,
      resource,
    });
    expect(begun.upstreamTokens.refreshToken).toBe("upstream-refresh-secret");

    const second = await core.completeUpstreamRefresh({
      attemptToken: begun.attemptToken,
      updatedGrant: upstreamGrant({
        tokens: {
          accessToken: "rotated-upstream-access",
          refreshToken: "rotated-upstream-refresh",
          tokenType: "Bearer",
          accessTokenExpiresAt: Date.now() + 60 * 60 * 1000,
        },
      }),
    });
    await expect(
      core.validateAccessToken(second.accessToken, resource)
    ).resolves.toMatchObject({
      providerAccessToken: "rotated-upstream-access",
    });
    await expectCoreError(
      core.completeUpstreamRefresh({ attemptToken: begun.attemptToken }),
      "invalid_grant"
    );
  });

  it("terminally revokes a family after an ambiguous upstream refresh", async () => {
    const core = createCore();
    const first = await issueTokens(core);
    const begun = await core.beginUpstreamRefresh({
      refreshToken: first.refreshToken,
      clientId,
      resource,
    });

    await core.markUpstreamRefreshAmbiguous({
      attemptToken: begun.attemptToken,
    });
    await expectCoreError(
      core.validateAccessToken(first.accessToken, resource),
      "invalid_token"
    );
    await expectCoreError(
      core.completeUpstreamRefresh({ attemptToken: begun.attemptToken }),
      "invalid_grant"
    );
  });

  it("fails closed when an upstream refresh attempt expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
    const core = createCore({
      store: resolveOAuthProxyStore().store,
      ttls: {
        accessTokenMs: 4000,
        authorizationCodeMs: 1000,
        browserTransactionMs: 1000,
        refreshAttemptMs: 1000,
        refreshIdleMs: 4000,
        refreshFamilyMs: 5000,
        clientRegistrationMs: 5000,
      },
    });
    const first = await issueTokens(core);
    const begun = await core.beginUpstreamRefresh({
      refreshToken: first.refreshToken,
      clientId,
      resource,
    });

    await vi.advanceTimersByTimeAsync(1001);
    await expectCoreError(
      core.completeUpstreamRefresh({ attemptToken: begun.attemptToken }),
      "upstream_reauthorization_required"
    );
    await expectCoreError(
      core.validateAccessToken(first.accessToken, resource),
      "invalid_token"
    );
  });

  it("can mark an attempt ambiguous after its logical TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
    const core = createCore({
      store: resolveOAuthProxyStore().store,
      ttls: {
        accessTokenMs: 4000,
        authorizationCodeMs: 1000,
        browserTransactionMs: 1000,
        refreshAttemptMs: 1000,
        refreshIdleMs: 4000,
        refreshFamilyMs: 5000,
        clientRegistrationMs: 5000,
      },
    });
    const first = await issueTokens(core);
    const begun = await core.beginUpstreamRefresh({
      refreshToken: first.refreshToken,
      clientId,
      resource,
    });

    await vi.advanceTimersByTimeAsync(1001);
    await core.markUpstreamRefreshAmbiguous({
      attemptToken: begun.attemptToken,
    });
    await expectCoreError(
      core.validateAccessToken(first.accessToken, resource),
      "invalid_token"
    );
  });

  it("revokes a stale refreshing family on the next access validation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
    const core = createCore({
      store: resolveOAuthProxyStore().store,
      ttls: {
        accessTokenMs: 4000,
        authorizationCodeMs: 1000,
        browserTransactionMs: 1000,
        refreshAttemptMs: 1000,
        refreshIdleMs: 4000,
        refreshFamilyMs: 5000,
        clientRegistrationMs: 5000,
      },
    });
    const first = await issueTokens(core);
    await core.beginUpstreamRefresh({
      refreshToken: first.refreshToken,
      clientId,
      resource,
    });

    await vi.advanceTimersByTimeAsync(1001);
    await expectCoreError(
      core.validateAccessToken(first.accessToken, resource),
      "invalid_token"
    );
  });

  it("atomically rolls back a pending grant when code creation fails", async () => {
    const underlying = resolveOAuthProxyStore().store;
    const grantKeys: string[] = [];
    const store = instrumentStore(underlying, {
      create(key) {
        if (key.startsWith("oauth-proxy:grant:")) grantKeys.push(key);
        if (key.startsWith("oauth-proxy:code:")) {
          throw new Error("injected code write failure");
        }
      },
    });
    const core = createCore({ store });

    await expect(issueCode(core)).rejects.toThrow(
      "injected code write failure"
    );
    expect(grantKeys).toHaveLength(1);
    await expect(underlying.read(grantKeys[0]!)).resolves.toEqual({
      status: "missing",
    });
  });

  it("expires abandoned pending grants with their authorization codes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
    const underlying = resolveOAuthProxyStore().store;
    const grantKeys: string[] = [];
    const core = createCore({
      store: instrumentStore(underlying, {
        create(key) {
          if (key.startsWith("oauth-proxy:grant:")) grantKeys.push(key);
        },
      }),
      ttls: {
        accessTokenMs: 1000,
        authorizationCodeMs: 1000,
        browserTransactionMs: 1000,
        refreshAttemptMs: 1000,
        refreshIdleMs: 2000,
        refreshFamilyMs: 3000,
        clientRegistrationMs: 3000,
      },
    });
    await issueCode(core);

    expect(grantKeys).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1001);
    await expect(underlying.read(grantKeys[0]!)).resolves.toEqual({
      status: "missing",
    });
  });

  it("tombstones the prior upstream grant after successful rotation", async () => {
    const underlying = resolveOAuthProxyStore().store;
    const grantKeys: string[] = [];
    const core = createCore({
      store: instrumentStore(underlying, {
        create(key) {
          if (key.startsWith("oauth-proxy:grant:")) grantKeys.push(key);
        },
      }),
    });
    const first = await issueTokens(core);
    const begun = await core.beginUpstreamRefresh({
      refreshToken: first.refreshToken,
      clientId,
      resource,
    });
    await core.completeUpstreamRefresh({
      attemptToken: begun.attemptToken,
      updatedGrant: upstreamGrant({
        tokens: {
          accessToken: "next-upstream-access",
          refreshToken: "next-upstream-refresh",
          tokenType: "Bearer",
          accessTokenExpiresAt: Date.now() + 60 * 60 * 1000,
        },
      }),
    });

    expect([...new Set(grantKeys)]).toHaveLength(2);
    await expect(underlying.read(grantKeys[0]!)).resolves.toEqual({
      status: "replayed",
    });
  });

  it("revokes access and refresh handles without an existence signal", async () => {
    const core = createCore();
    const accessRevoked = await issueTokens(core);
    await expect(
      core.revokeLocalToken({
        token: accessRevoked.accessToken,
        tokenTypeHint: "access_token",
      })
    ).resolves.toBeUndefined();
    await expectCoreError(
      core.validateAccessToken(accessRevoked.accessToken, resource),
      "invalid_token"
    );

    const refreshRevoked = await issueTokens(core);
    await expect(
      core.revokeLocalToken({
        token: refreshRevoked.refreshToken,
        tokenTypeHint: "refresh_token",
      })
    ).resolves.toBeUndefined();
    await expectCoreError(
      core.validateAccessToken(refreshRevoked.accessToken, resource),
      "invalid_token"
    );
    await expect(
      core.revokeLocalToken({ token: "n".repeat(43) })
    ).resolves.toBeUndefined();
    await expect(
      core.revokeLocalToken({ token: "not-a-local-token" })
    ).resolves.toBeUndefined();
  });

  it("expires short-lived local access state", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
    const core = createCore({
      store: resolveOAuthProxyStore().store,
      ttls: {
        accessTokenMs: 1000,
        authorizationCodeMs: 1000,
        browserTransactionMs: 1000,
        refreshAttemptMs: 1000,
        refreshIdleMs: 2000,
        refreshFamilyMs: 3000,
        clientRegistrationMs: 3000,
      },
    });
    const tokens = await issueTokens(core);
    await vi.advanceTimersByTimeAsync(1001);
    await expectCoreError(
      core.validateAccessToken(tokens.accessToken, resource),
      "invalid_token"
    );
  });

  it("rejects non-JSON provider payloads before persistence", async () => {
    const core = createCore();
    await expect(
      core.persistGrantAndIssueAuthorizationCode({
        clientId,
        redirectUri,
        resource,
        scopes: ["read"],
        codeChallenge: await s256(verifier),
        grant: {
          ...upstreamGrant(),
          userPayload: { invalid: undefined } as never,
        },
      })
    ).rejects.toThrow("OAuth proxy state is invalid");
  });

  it("refuses to overstate a sub-second upstream access lifetime", async () => {
    const core = createCore();
    const issued = await core.persistGrantAndIssueAuthorizationCode({
      clientId,
      redirectUri,
      resource,
      scopes: ["read"],
      codeChallenge: await s256(verifier),
      grant: upstreamGrant({
        tokens: {
          accessToken: "short-upstream-access",
          tokenType: "Bearer",
          accessTokenExpiresAt: Date.now() + 500,
        },
      }),
    });
    await expectCoreError(
      core.exchangeAuthorizationCode({
        code: issued.code,
        clientId,
        redirectUri,
        resource,
        codeVerifier: verifier,
      }),
      "upstream_reauthorization_required"
    );
  });

  it("never stores raw local codes or bearer tokens as keys or payload values", async () => {
    const underlying = resolveOAuthProxyStore().store;
    const captured: string[] = [];
    const store = captureStore(underlying, captured);
    const core = createCore({ store });
    const issued = await issueCode(core);
    const tokens = await core.exchangeAuthorizationCode({
      code: issued.code,
      clientId,
      redirectUri,
      resource,
      codeVerifier: verifier,
    });

    const serialized = captured.join("\n");
    expect(serialized).not.toContain(issued.code);
    expect(serialized).not.toContain(tokens.accessToken);
    expect(serialized).not.toContain(tokens.refreshToken);
  });
});

function captureStore(
  store: OAuthProxyStore,
  captured: string[]
): OAuthProxyStore {
  const capture = (key: string, payload?: Uint8Array) => {
    captured.push(key);
    if (payload !== undefined) captured.push(new TextDecoder().decode(payload));
  };
  const wrap = (
    transaction: OAuthProxyStoreTransaction
  ): OAuthProxyStoreTransaction => ({
    create(key, payload, expiresAt) {
      capture(key, payload);
      return transaction.create(key, payload, expiresAt);
    },
    read(key) {
      capture(key);
      return transaction.read(key);
    },
    replace(key, payload, expiresAt) {
      capture(key, payload);
      return transaction.replace(key, payload, expiresAt);
    },
    consume(key) {
      capture(key);
      return transaction.consume(key);
    },
  });
  const transaction = <T>(
    keys: readonly string[],
    work: (transaction: OAuthProxyStoreTransaction) => T | Promise<T>
  ) => {
    for (const key of keys) capture(key);
    return store.transaction(keys, (inner) => work(wrap(inner)));
  };
  return {
    capabilities: store.capabilities,
    transaction,
    create(key, payload, expiresAt) {
      return transaction([key], (inner) =>
        inner.create(key, payload, expiresAt)
      );
    },
    read(key) {
      return transaction([key], (inner) => inner.read(key));
    },
    replace(key, payload, expiresAt) {
      return transaction([key], (inner) =>
        inner.replace(key, payload, expiresAt)
      );
    },
    consume(key) {
      return transaction([key], (inner) => inner.consume(key));
    },
  };
}

function instrumentStore(
  store: OAuthProxyStore,
  observer: { readonly create?: (key: string) => void }
): OAuthProxyStore {
  const wrap = (
    transaction: OAuthProxyStoreTransaction
  ): OAuthProxyStoreTransaction => ({
    create(key, payload, expiresAt) {
      observer.create?.(key);
      return transaction.create(key, payload, expiresAt);
    },
    read: transaction.read.bind(transaction),
    replace: transaction.replace.bind(transaction),
    consume: transaction.consume.bind(transaction),
  });
  const run = <T>(
    keys: readonly string[],
    work: (transaction: OAuthProxyStoreTransaction) => T | Promise<T>
  ) => store.transaction(keys, (transaction) => work(wrap(transaction)));
  return {
    capabilities: store.capabilities,
    transaction: run,
    create(key, payload, expiresAt) {
      return run([key], (transaction) =>
        transaction.create(key, payload, expiresAt)
      );
    },
    read(key) {
      return run([key], (transaction) => transaction.read(key));
    },
    replace(key, payload, expiresAt) {
      return run([key], (transaction) =>
        transaction.replace(key, payload, expiresAt)
      );
    },
    consume(key) {
      return run([key], (transaction) => transaction.consume(key));
    },
  };
}
