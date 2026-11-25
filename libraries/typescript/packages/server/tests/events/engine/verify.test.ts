import { describe, expect, it } from "vitest";
import {
  createVerifier,
  type VerifyRequest,
} from "../../../src/events/engine/verify/index.js";
import {
  harness,
  registryOf,
  SECRET,
  SEP_AXES,
  status,
} from "./engine-harness.js";

const req: VerifyRequest = {
  url: "https://hooks.example.com/in",
  secret: SECRET,
  subscriptionId: "sub_A",
  principal: "alice",
  axes: SEP_AXES,
};

const echo = (r: { body: string }) =>
  status(200, {}, JSON.stringify({ challenge: JSON.parse(r.body).challenge }));

describe("verification", () => {
  it("challenge echo succeeds and is cached per (principal, url) (S-1)", async () => {
    const h = harness(registryOf());
    const v = createVerifier(h.ctx);
    h.sender.script.push(echo);
    expect(await v.verify(req)).toEqual({ ok: true, via: "challenge" });
    const sent = JSON.parse(h.sender.calls[0]!.body);
    expect(sent.type).toBe("verification");
    expect(h.sender.calls[0]!.headers["webhook-id"]).toMatch(
      /^msg_verification_/
    );
    expect(await v.verify(req)).toEqual({
      ok: true,
      via: "challenge",
      cached: true,
    });
    expect(h.sender.calls).toHaveLength(1);
  });

  it("a wrong echo fails with challenge_failed and is cached for 60 s (S-9)", async () => {
    const h = harness(registryOf());
    const v = createVerifier(h.ctx);
    h.sender.script.push(status(200, {}, '{"challenge":"nope"}'));
    expect(await v.verify(req)).toEqual({
      ok: false,
      reason: "challenge_failed",
      retryAfterMs: 60_000,
    });
    expect(await v.verify(req)).toEqual({
      ok: false,
      reason: "challenge_failed",
      retryAfterMs: 60_000,
      limited: true,
    });
    await h.clock.advance(60_000);
    h.sender.script.push(echo);
    expect((await v.verify(req)).ok).toBe(true);
  });

  it("a byte-equal reflection warns by default and is rejected under reject (S-10)", async () => {
    const h = harness(registryOf());
    const v = createVerifier(h.ctx);
    h.sender.script.push((r) => status(200, {}, r.body));
    expect(await v.verify(req)).toEqual({
      ok: true,
      via: "challenge",
      warning: "reflected",
    });
    h.sender.script.push((r) => status(200, {}, r.body));
    expect(
      await v.verify({ ...req, principal: "bob", antiReflection: "reject" })
    ).toMatchObject({
      ok: false,
      reason: "challenge_failed",
    });
  });

  it("allowlisted URLs are pre-verified without a POST (S-11)", async () => {
    const h = harness(registryOf());
    const v = createVerifier(h.ctx, {
      allowlist: ["https://hooks.example.com/"],
    });
    expect(await v.verify(req)).toEqual({ ok: true, via: "allowlist" });
    expect(h.sender.calls).toHaveLength(0);
  });

  it("trusted origins are challenged and refused through the tunnel (S-24)", async () => {
    const h = harness(registryOf());
    const v = createVerifier(h.ctx, {
      trustedOrigins: ["http://localhost:3000"],
    });
    const local = { ...req, url: "http://localhost:3000/inbox" };
    h.sender.script.push(echo);
    expect(await v.verify(local)).toEqual({ ok: true, via: "trusted-origin" });
    expect(
      await v.verify({ ...local, principal: "bob", viaTunnel: true })
    ).toMatchObject({
      ok: false,
      reason: "connection_refused",
    });
  });

  it("well-known receiver documents verify without a challenge (VERIFY-WELLKNOWN)", async () => {
    const h = harness(registryOf());
    const fetched: string[] = [];
    const v = createVerifier(h.ctx, {
      fetchWellKnown: async (url) => {
        fetched.push(url);
        return { status: 200, headers: {}, body: '{"receivers":["/in"]}' };
      },
    });
    expect(await v.verify(req)).toEqual({ ok: true, via: "well-known" });
    expect(await v.verify({ ...req, principal: "bob" })).toEqual({
      ok: true,
      via: "well-known",
    });
    expect(fetched).toEqual([
      "https://hooks.example.com/.well-known/mcp-webhook-receiver.json",
    ]);
    expect(h.sender.calls).toHaveLength(0);
  });

  it("limits verifications per (principal, host) per minute (S-25)", async () => {
    const h = harness(registryOf());
    const v = createVerifier(h.ctx, {
      limits: { perPrincipalHostPerMinute: 1 },
    });
    h.sender.script.push(status(500));
    await v.verify(req);
    const r = await v.verify({
      ...req,
      url: "https://hooks.example.com/other",
    });
    expect(r).toMatchObject({ ok: false, limited: true });
    expect(h.sender.calls).toHaveLength(1);
  });

  it("uses the row's verificationTimeoutMs (K-O row)", async () => {
    const h = harness(registryOf());
    const v = createVerifier(h.ctx);
    h.sender.script.push(echo);
    await v.verify({ ...req, verificationTimeoutMs: 1234 });
    expect(h.sender.calls[0]!.timeoutMs).toBe(1234);
  });
});
