import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeJwt } from "jose";
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { jwt } from "better-auth/plugins";

import { createNativeMcpAuth } from "../src/oauth/better-auth-mcp.js";
import {
  NativeIdentityError,
  type NativeIdentityAdapter,
  type NativeIdentityRevalidation,
} from "../src/oauth/native-identity.js";
import {
  authorize,
  OAuthBrowser,
  proofKey,
  startBroker,
  tokens,
} from "./helpers/oauth-broker.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function nativeBroker(
  database?: DatabaseSync,
  overrides: Partial<NativeIdentityAdapter> = {}
) {
  const account = { status: "valid" as "valid" | "invalid" | "unavailable" };
  const identity = {
    subject: "native-user",
    profile: { name: "Native fixture user" },
    binding: { subject: "native-user" },
  };
  // Only the external identity source is controlled. OAuth, SQL persistence,
  // signatures, DPoP and request authentication are the actual implementation.
  const broker = await startBroker(
    (options) =>
      createNativeMcpAuth({
        ...options,
        sessionPolicy: "strict",
        providers: {
          fixture: {
            source: "native-test-issuer",
            async authenticate({ proof }) {
              if (proof !== "fixture-login")
                throw new NativeIdentityError("invalid");
              return { identity };
            },
            async revalidate() {
              return account.status === "valid"
                ? { status: "valid", identity }
                : { status: account.status };
            },
            async checkStatus() {
              return account.status;
            },
            ...overrides,
          },
        },
      }),
    database
  );
  cleanup.push(broker.close);
  const browser = new OAuthBrowser([broker.origin]);
  const login = async (query: string) => {
    const begin = await browser.request(`${broker.base}/native/start`, {
      provider: "fixture",
      oauth_query: query,
    });
    expect(begin.status).toBe(200);
    const { csrf } = (await begin.json()) as { csrf: string };
    return browser.request(`${broker.base}/native/sign-in`, {
      provider: "fixture",
      proof: "fixture-login",
      oauth_query: query,
      csrf,
    });
  };
  return {
    broker,
    account,
    identity,
    grant: (thumbprint?: string) =>
      authorize(broker, browser, login, thumbprint),
  };
}

describe("Better Auth MCP broker (real engine and SQLite)", () => {
  it.each(["valid", "invalid", "reject"] as const)(
    "times out a hung refresh and fences late %s completion while holding the client lock",
    async (late) => {
      const revalidate =
        vi.fn<NonNullable<NativeIdentityAdapter["revalidate"]>>();
      const fixture = await nativeBroker(undefined, {
        revalidate: (...args) => revalidate(...args),
      });
      const { broker, identity, grant } = fixture;
      revalidate.mockResolvedValue({ status: "valid", identity });
      const authorization = await grant();
      const issued = await tokens(await broker.token(authorization.fields));
      const before = broker.session(issued.access_token)!;
      const refreshBefore = broker.refreshRows();
      let started!: () => void;
      const entered = new Promise<void>((resolve) => {
        started = resolve;
      });
      let finish!: (result: NativeIdentityRevalidation) => void;
      let fail!: (error: Error) => void;
      let providerSignal!: AbortSignal;
      revalidate.mockClear();
      revalidate.mockImplementationOnce((_binding, signal) => {
        providerSignal = signal;
        started();
        return new Promise((resolve, reject) => {
          finish = resolve;
          fail = reject;
        });
      });
      const renew = () =>
        broker.integration.handle(
          new Request(`${broker.base}/oauth2/token`, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              grant_type: "refresh_token",
              client_id: authorization.clientId,
              refresh_token: issued.refresh_token,
              resource: broker.resource,
            }),
          })
        );
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const pending = renew();
      await entered;
      await vi.advanceTimersByTimeAsync(10_001);
      expect((await pending)!.status).toBe(503);
      expect(providerSignal.aborted).toBe(true);
      expect(
        broker.session(issued.access_token)!.nativeLeaseOwner
      ).toBeTruthy();
      const overlapping = renew();
      await vi.advanceTimersByTimeAsync(1_001);
      expect((await overlapping)!.status).toBe(503);
      expect(revalidate).toHaveBeenCalledTimes(1);
      // Revocation does not revalidate the session: only the client lock can
      // prevent this mutation while the timed-out refresh is still running.
      const revocation = broker.integration.handle(
        new Request(`${broker.base}/oauth2/revoke`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: authorization.clientId,
            token: issued.refresh_token,
            token_type_hint: "refresh_token",
          }),
        })
      );
      await vi.advanceTimersByTimeAsync(1_001);
      expect((await revocation)!.status).toBe(503);
      expect(broker.refreshRows()).toEqual(refreshBefore);
      if (late === "reject") fail(new Error("late provider failure"));
      else
        finish(
          late === "valid"
            ? {
                status: "valid",
                identity: {
                  ...identity,
                  profile: { name: "Late profile" },
                  binding: { rotated: true },
                },
              }
            : { status: "invalid" }
        );
      await vi.waitFor(() =>
        expect(broker.session(issued.access_token)!.nativeLeaseOwner).toBeNull()
      );
      expect(broker.session(issued.access_token)).toEqual({
        ...before,
        updatedAt: expect.any(String),
      });
      expect(broker.refreshRows()).toEqual(refreshBefore);
      vi.useRealTimers();
      expect((await renew())!.status).toBe(200);
    }
  );

  it.each(["valid", "invalid"] as const)(
    "discards a %s provider result after the session lease changes owners",
    async (status) => {
      const revalidate =
        vi.fn<NonNullable<NativeIdentityAdapter["revalidate"]>>();
      const { broker, identity, grant } = await nativeBroker(undefined, {
        revalidate,
      });
      revalidate.mockResolvedValue({ status: "valid", identity });
      const authorization = await grant();
      const issued = await tokens(await broker.token(authorization.fields));
      const before = broker.session(issued.access_token)!;
      const refreshBefore = broker.refreshRows();
      revalidate.mockImplementationOnce(async () => {
        const prefix = `mcp_${broker.auth.basePath.split("/")[2]}_`;
        broker.db
          .prepare(
            `UPDATE "${prefix}session" SET nativeLeaseOwner = ? WHERE id = ?`
          )
          .run("another-worker", String(before.id));
        return status === "invalid"
          ? { status }
          : {
              status: "valid",
              identity: { ...identity, binding: { rotated: true } },
            };
      });
      expect(
        (
          await broker.token({
            grant_type: "refresh_token",
            client_id: authorization.clientId,
            refresh_token: issued.refresh_token,
          })
        ).status
      ).toBe(503);
      expect(broker.session(issued.access_token)).toMatchObject({
        nativeLeaseOwner: "another-worker",
        nativeBinding: before.nativeBinding,
        nativeProfile: before.nativeProfile,
      });
      expect(broker.refreshRows()).toEqual(refreshBefore);
    }
  );

  it("cancels expiry recovery without applying a late revocation", async () => {
    const revalidate =
      vi.fn<NonNullable<NativeIdentityAdapter["revalidate"]>>();
    const checkStatus = vi
      .fn<NonNullable<NativeIdentityAdapter["checkStatus"]>>()
      .mockResolvedValue("valid");
    const { broker, identity, grant } = await nativeBroker(undefined, {
      revalidate,
      checkStatus,
    });
    revalidate.mockResolvedValue({ status: "valid", identity });
    const issued = await tokens(await broker.token((await grant()).fields));
    const before = broker.session(issued.access_token)!;
    checkStatus.mockResolvedValue("expired");
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    let finish!: (result: NativeIdentityRevalidation) => void;
    revalidate.mockImplementationOnce((_binding, signal) => {
      expect(signal.aborted).toBe(false);
      started();
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const controller = new AbortController();
    const pending = broker.integration.requestAuth.authenticate(
      new Request(broker.resource, {
        headers: { authorization: `Bearer ${issued.access_token}` },
        signal: controller.signal,
      })
    );
    await entered;
    controller.abort();
    expect(await pending).toMatchObject({ status: 503 });
    finish({ status: "invalid" });
    await vi.waitFor(() =>
      expect(broker.session(issued.access_token)!.nativeLeaseOwner).toBeNull()
    );
    expect(broker.session(issued.access_token)).toEqual({
      ...before,
      updatedAt: expect.any(String),
    });
  });

  it("isolates two MCP engines from existing application sessions, keys and business data", async () => {
    const database = new DatabaseSync(":memory:");
    cleanup.push(async () => database.close());
    database.exec(
      "CREATE TABLE orders (id TEXT PRIMARY KEY, marker TEXT); INSERT INTO orders VALUES ('business', 'unchanged')"
    );
    const application = betterAuth({
      database,
      baseURL: "http://localhost:3130",
      basePath: "/app-auth",
      secret: "existing-application-fixture-secret-0123456789",
      emailAndPassword: { enabled: true },
      logger: { disabled: true },
      plugins: [jwt()],
    });
    await (await getMigrations(application.options)).runMigrations();
    const signup = await application.handler(
      new Request("http://localhost:3130/app-auth/sign-up/email", {
        method: "POST",
        headers: {
          origin: "http://localhost:3130",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Business user",
          email: "business@example.test",
          password: "fixture-password-0123456789",
        }),
      })
    );
    expect(signup.status).toBe(200);
    const cookie = signup.headers
      .getSetCookie()
      .map((value) => value.split(";", 1)[0])
      .join("; ");
    const originalUser = (await signup.json()).user;
    const originalKeys = await application.api.getJwks();
    const one = await nativeBroker(database);
    const two = await nativeBroker(database);
    const first = await tokens(
      await one.broker.token((await one.grant()).fields)
    );
    const second = await tokens(
      await two.broker.token((await two.grant()).fields)
    );
    expect(one.broker.auth.basePath).not.toBe(two.broker.auth.basePath);
    expect(decodeJwt(first.access_token).sub).not.toBe(
      decodeJwt(second.access_token).sub
    );
    expect((await two.broker.tool(first.access_token)).status).toBe(401);
    expect(two.broker.executions).toBe(0);
    expect((await two.broker.tool(second.access_token)).status).toBe(200);
    expect(
      (await application.api.getSession({ headers: new Headers({ cookie }) }))
        ?.user.id
    ).toBe(originalUser.id);
    expect(await application.api.getJwks()).toEqual(originalKeys);
    expect(
      database.prepare("SELECT marker FROM orders WHERE id = 'business'").get()
        ?.marker
    ).toBe("unchanged");
    expect(database.prepare("SELECT count(*) AS n FROM user").get()?.n).toBe(1);
    for (const { broker } of [one, two]) {
      const migration = await broker.auth.getMigrations();
      expect(migration.toBeCreated).toEqual([]);
      expect(migration.toBeAdded).toEqual([]);
      expect(migration.toBeAddedIndexes).toEqual([]);
      expect(
        await broker.integration.handle(
          new Request("http://localhost:3130/app-auth/jwks")
        )
      ).toBeUndefined();
    }
  });

  it("exchanges a code, serves a protected tool, rotates refresh tokens and rejects reuse", async () => {
    const { broker, grant } = await nativeBroker();
    const authorization = await grant();
    const issued = await tokens(await broker.token(authorization.fields));
    expect(decodeJwt(issued.access_token)).toMatchObject({
      iss: broker.base,
      aud: broker.resource,
      native_identity: { source: "native-test-issuer", subject: "native-user" },
    });
    const tool = await broker.tool(issued.access_token);
    expect(tool.status).toBe(200);
    expect(await tool.json()).toMatchObject({
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              source: "native-test-issuer",
              subject: "native-user",
              profile: { name: "Native fixture user" },
            }),
          },
        ],
      },
    });
    expect(broker.executions).toBe(1);
    const refresh = (token: string) =>
      broker.token({
        grant_type: "refresh_token",
        client_id: authorization.clientId,
        refresh_token: token,
      });
    const renewed = await tokens(await refresh(issued.refresh_token));
    expect(renewed.refresh_token).not.toBe(issued.refresh_token);
    expect(broker.refreshRows().filter((row) => !row.revoked)).toHaveLength(1);
    const replay = await refresh(issued.refresh_token);
    expect(replay.status).toBe(400);
    expect(await replay.json()).toMatchObject({ error: "invalid_grant" });
    const family = await refresh(renewed.refresh_token);
    expect(family.status).toBe(400);
    expect(await family.json()).toMatchObject({ error: "invalid_grant" });
  });

  it("never issues two successful rotations for simultaneous uses of one refresh token", async () => {
    const { broker, grant } = await nativeBroker();
    const authorization = await grant();
    const issued = await tokens(await broker.token(authorization.fields));
    const fields = {
      grant_type: "refresh_token",
      client_id: authorization.clientId,
      refresh_token: issued.refresh_token,
    };
    const replies = await Promise.all([
      broker.token(fields),
      broker.token(fields),
    ]);
    expect(replies.filter((reply) => reply.status === 200)).toHaveLength(1);
    const winner = await tokens(replies.find((reply) => reply.status === 200)!);
    const loser = replies.find((reply) => reply.status !== 200)!;
    expect([400, 503]).toContain(loser.status);
    const rejected = await loser.json();
    expect(rejected).toMatchObject({
      error: loser.status === 400 ? "invalid_grant" : "temporarily_unavailable",
    });
    expect(rejected).not.toHaveProperty("access_token");
    expect(rejected).not.toHaveProperty("refresh_token");
    // A busy response alone is not proof of replay rejection. Retry explicitly
    // after the winning request has finished and inspect the resulting family.
    const replay = await broker.token(fields);
    expect(replay.status).toBe(400);
    expect(await replay.json()).toMatchObject({ error: "invalid_grant" });
    const family = await broker.token({
      ...fields,
      refresh_token: winner.refresh_token,
    });
    expect(family.status).toBe(400);
    expect(await family.json()).toMatchObject({ error: "invalid_grant" });
    expect(broker.refreshRows().filter((row) => !row.revoked)).toHaveLength(0);
  });

  it("rejects authorization-code replay without minting another grant", async () => {
    const { broker, grant } = await nativeBroker();
    const authorization = await grant();
    const issued = await tokens(await broker.token(authorization.fields));
    expect(broker.refreshRows()).toHaveLength(1);
    const replay = await broker.token(authorization.fields);
    expect(replay.status).toBe(400);
    expect(await replay.json()).toMatchObject({ error: "invalid_grant" });
    expect(broker.refreshRows()).toHaveLength(0);
    const renewal = await broker.token({
      grant_type: "refresh_token",
      client_id: authorization.clientId,
      refresh_token: issued.refresh_token,
    });
    expect(renewal.status).toBe(400);
  });

  it("preserves sessions and refresh state during outages, then permanently rejects revoked sessions", async () => {
    const { broker, account, grant } = await nativeBroker();
    const authorization = await grant();
    const issued = await tokens(await broker.token(authorization.fields));
    const fields = {
      grant_type: "refresh_token",
      client_id: authorization.clientId,
      refresh_token: issued.refresh_token,
    };
    const before = broker.refreshRows();
    account.status = "unavailable";
    expect((await broker.tool(issued.access_token)).status).toBe(503);
    expect((await broker.token(fields)).status).toBe(503);
    expect(broker.executions).toBe(0);
    expect(broker.session(issued.access_token)).toBeDefined();
    expect(broker.refreshRows()).toEqual(before);
    account.status = "valid";
    expect((await broker.tool(issued.access_token)).status).toBe(200);
    const renewed = await tokens(await broker.token(fields));
    account.status = "invalid";
    expect(decodeJwt(renewed.access_token).exp).toBeGreaterThan(
      Date.now() / 1000
    );
    expect((await broker.tool(renewed.access_token)).status).toBe(401);
    expect(broker.executions).toBe(1);
    expect(broker.session(renewed.access_token)).toBeUndefined();
    account.status = "valid";
    expect((await broker.tool(renewed.access_token)).status).toBe(401);
    const denied = await broker.token({
      ...fields,
      refresh_token: renewed.refresh_token,
    });
    expect(denied.status).toBe(400);
    expect(await denied.json()).toMatchObject({ error: "invalid_grant" });
  });

  it("verifies actual DPoP proofs, rejects replay and returns the fixed wrong-typ challenge", async () => {
    const { broker, grant } = await nativeBroker();
    const key = await proofKey();
    const authorization = await grant(key.thumbprint);
    const issued = await tokens(
      await broker.token(
        authorization.fields,
        await key.sign(`${broker.base}/oauth2/token`)
      )
    );
    expect(issued.token_type).toBe("DPoP");
    expect(decodeJwt(issued.access_token).cnf).toEqual({ jkt: key.thumbprint });
    const proof = await key.sign(broker.resource, issued.access_token);
    expect((await broker.tool(issued.access_token, proof, "DPoP")).status).toBe(
      200
    );
    expect(broker.executions).toBe(1);
    const otherKey = await proofKey();
    const untampered = await key.sign(broker.resource, issued.access_token);
    const parts = untampered.split(".");
    const signature = Buffer.from(parts[2]!, "base64url");
    signature[0] = signature[0]! ^ 1;
    parts[2] = signature.toString("base64url");
    for (const invalid of [
      proof,
      parts.join("."),
      await key.sign(broker.resource, issued.access_token, "JWT"),
      await key.sign(`${broker.resource}/wrong`, issued.access_token),
      await otherKey.sign(broker.resource, issued.access_token),
      undefined,
    ]) {
      const rejected = await broker.tool(issued.access_token, invalid, "DPoP");
      expect(rejected.status).toBe(401);
      expect(rejected.headers.get("www-authenticate")).toMatch(/^DPoP\b/);
      expect(broker.executions).toBe(1);
    }
    // Rejecting an invalid signature must not reserve the valid proof's jti.
    expect(
      (await broker.tool(issued.access_token, untampered, "DPoP")).status
    ).toBe(200);
    expect(broker.executions).toBe(2);
  });
});
