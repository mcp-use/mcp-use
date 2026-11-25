import { Webhook } from "standardwebhooks";
import { describe, expect, it } from "vitest";
import {
  generateWebhookId,
  generateWebhookSecret,
  parseWebhookSecret,
  signWebhook,
  validateWebhookSecret,
  verifyWebhook,
  WebhookVerificationError,
} from "../src/index.js";
import { readVector } from "./vectors.js";

const encoder = new TextEncoder();

interface SignatureCase {
  case: string;
  secrets: string[];
  webhookId: string;
  timestamp: number;
  body: string;
  signature: string;
}

const signatures = readVector<{ cases: SignatureCase[] }>(
  "webhook-signatures.json"
).cases;

function secretBytes(secret: string): Uint8Array {
  const bytes = parseWebhookSecret(secret);
  if (!bytes) throw new Error(`bad test secret ${secret}`);
  return bytes;
}

function headersFor(c: {
  webhookId: string;
  timestamp: number | string;
  signature: string;
  subscriptionId?: string;
}): Headers {
  const h = new Headers({
    "webhook-id": c.webhookId,
    "webhook-timestamp": String(c.timestamp),
    "webhook-signature": c.signature,
  });
  if (c.subscriptionId) h.set("X-MCP-Subscription-Id", c.subscriptionId);
  return h;
}

async function rejection(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof WebhookVerificationError) return e.reason;
    throw e;
  }
  return "verified";
}

describe("signWebhook reproduces vectors/webhook-signatures.json", () => {
  for (const c of signatures) {
    it(c.case, async () => {
      expect(
        await signWebhook(
          c.secrets.map(secretBytes),
          c.webhookId,
          c.timestamp,
          encoder.encode(c.body)
        )
      ).toBe(c.signature);
    });
  }
});

describe("verifyWebhook", () => {
  for (const c of signatures) {
    it(`verifies ${c.case}`, async () => {
      const result = await verifyWebhook({
        secrets: [c.secrets[0] as string],
        headers: headersFor({
          ...c,
          subscriptionId: "sub_Iq5lpyGFq-fw8XHkVwXohH",
        }),
        body: encoder.encode(c.body),
        now: c.timestamp * 1000,
      });
      expect(result).toEqual({
        webhookId: c.webhookId,
        timestamp: c.timestamp,
        subscriptionId: "sub_Iq5lpyGFq-fw8XHkVwXohH",
      });
    });
  }

  const rotation = signatures.find(
    (c) => c.case === "rotation-two-signers"
  ) as SignatureCase;

  it("accepts a rotation delivery with either signer's secret", async () => {
    for (const secret of rotation.secrets) {
      const result = await verifyWebhook({
        secrets: [secret],
        headers: headersFor(rotation),
        body: encoder.encode(rotation.body),
        now: rotation.timestamp * 1000,
      });
      expect(result.webhookId).toBe("msg_gap_Qm9vX2RlbW8tbWFjMDEyMz");
      expect(result.subscriptionId).toBe(null);
    }
  });

  it("accepts when any of several receiver secrets matches", async () => {
    const result = await verifyWebhook({
      secrets: [generateWebhookSecret(), rotation.secrets[1] as string],
      headers: headersFor(rotation),
      body: encoder.encode(rotation.body),
      now: rotation.timestamp * 1000,
    });
    expect(result.timestamp).toBe(1764000300);
  });

  it("rejects a secret that signed nothing", async () => {
    expect(
      await rejection(
        verifyWebhook({
          secrets: [generateWebhookSecret()],
          headers: headersFor(rotation),
          body: encoder.encode(rotation.body),
          now: rotation.timestamp * 1000,
        })
      )
    ).toBe("invalid_signature");
  });

  const published = signatures[0] as SignatureCase;

  it("rejects a body changed by one byte", async () => {
    expect(
      await rejection(
        verifyWebhook({
          secrets: published.secrets,
          headers: headersFor(published),
          body: encoder.encode('{"test": 2432232315}'),
          now: published.timestamp * 1000,
        })
      )
    ).toBe("invalid_signature");
  });

  it("enforces the 5 minute window in both directions and honours toleranceSec", async () => {
    const base = {
      secrets: published.secrets,
      headers: headersFor(published),
      body: encoder.encode(published.body),
    };
    expect(
      await rejection(
        verifyWebhook({ ...base, now: (published.timestamp + 300) * 1000 })
      )
    ).toBe("verified");
    expect(
      await rejection(
        verifyWebhook({ ...base, now: (published.timestamp + 301) * 1000 })
      )
    ).toBe("timestamp_out_of_tolerance");
    expect(
      await rejection(
        verifyWebhook({ ...base, now: (published.timestamp - 301) * 1000 })
      )
    ).toBe("timestamp_out_of_tolerance");
    expect(
      await rejection(
        verifyWebhook({
          ...base,
          now: (published.timestamp + 3600) * 1000,
          toleranceSec: 3600,
        })
      )
    ).toBe("verified");
  });

  it("ignores unknown signature versions such as v1a", async () => {
    const onlyV1a = headersFor({ ...published, signature: "v1a,abc" });
    expect(
      await rejection(
        verifyWebhook({
          secrets: published.secrets,
          headers: onlyV1a,
          body: encoder.encode(published.body),
          now: published.timestamp * 1000,
        })
      )
    ).toBe("invalid_signature");
    const mixed = headersFor({
      ...published,
      signature: `v1a,abc ${published.signature}`,
    });
    expect(
      await rejection(
        verifyWebhook({
          secrets: published.secrets,
          headers: mixed,
          body: encoder.encode(published.body),
          now: published.timestamp * 1000,
        })
      )
    ).toBe("verified");
  });

  it("reports missing headers, a bad timestamp and unusable secrets", async () => {
    const body = encoder.encode(published.body);
    const now = published.timestamp * 1000;
    const missing = headersFor(published);
    missing.delete("webhook-signature");
    expect(
      await rejection(
        verifyWebhook({
          secrets: published.secrets,
          headers: missing,
          body,
          now,
        })
      )
    ).toBe("missing_headers");
    expect(
      await rejection(
        verifyWebhook({
          secrets: published.secrets,
          headers: headersFor({ ...published, timestamp: "1614265330.5" }),
          body,
          now,
        })
      )
    ).toBe("invalid_timestamp");
    expect(
      await rejection(
        verifyWebhook({
          secrets: ["whsec_short"],
          headers: headersFor(published),
          body,
          now,
        })
      )
    ).toBe("no_valid_secret");
  });
});

describe("interop with the standardwebhooks library", () => {
  it("our signatures verify with standardwebhooks, and its signatures verify with ours", async () => {
    const secret = generateWebhookSecret();
    const body = '{"eventId":"note_1","name":"note.created","data":{}}';
    const id = generateWebhookId();
    const ts = Math.floor(Date.now() / 1000);
    const ours = await signWebhook(
      [secretBytes(secret)],
      id,
      ts,
      encoder.encode(body)
    );
    const lib = new Webhook(secret);
    expect(
      lib.verify(body, {
        "webhook-id": id,
        "webhook-timestamp": String(ts),
        "webhook-signature": ours,
      })
    ).toEqual({ eventId: "note_1", name: "note.created", data: {} });

    const theirs = lib.sign(id, new Date(ts * 1000), body);
    const verified = await verifyWebhook({
      secrets: [secret],
      headers: headersFor({ webhookId: id, timestamp: ts, signature: theirs }),
      body: encoder.encode(body),
    });
    expect(verified.webhookId).toBe(id);
  });
});

describe("webhook ids and secrets", () => {
  it("generates msg_ ids with 22 base64url characters, and msg_<type>_ ids for control envelopes", () => {
    expect(generateWebhookId()).toMatch(/^msg_[A-Za-z0-9_-]{22}$/);
    expect(generateWebhookId("event")).toMatch(/^msg_[A-Za-z0-9_-]{22}$/);
    expect(generateWebhookId("verification")).toMatch(
      /^msg_verification_[A-Za-z0-9_-]{22}$/
    );
    expect(generateWebhookId("gap")).toMatch(/^msg_gap_[A-Za-z0-9_-]{22}$/);
    expect(generateWebhookId("terminated")).toMatch(
      /^msg_terminated_[A-Za-z0-9_-]{22}$/
    );
    expect(generateWebhookId()).not.toBe(generateWebhookId());
  });

  it("generates secrets that pass strict validation, 32 bytes by default", () => {
    const secret = generateWebhookSecret();
    expect(secret).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/);
    const check = validateWebhookSecret(secret);
    expect(check.ok && check.bytes.length).toBe(32);
    const big = validateWebhookSecret(generateWebhookSecret(64));
    expect(big.ok && big.bytes.length).toBe(64);
    expect(() => generateWebhookSecret(23)).toThrow(RangeError);
    expect(() => generateWebhookSecret(65)).toThrow(RangeError);
  });

  const secrets = readVector<{
    strict: Array<{
      secret: string;
      ok: boolean;
      bytes?: number;
      reason?: string;
    }>;
    lenient: Array<{ secret: string; bytes: number | null }>;
  }>("webhook-secrets.json");

  for (const c of secrets.strict) {
    it(`strict ${c.secret.slice(0, 30)} → ${c.ok ? c.bytes : c.reason}`, () => {
      const check = validateWebhookSecret(c.secret);
      if (c.ok) {
        expect(check.ok).toBe(true);
        expect(check.ok && check.bytes.length).toBe(c.bytes);
      } else {
        expect(check).toEqual({ ok: false, reason: c.reason });
      }
    });
  }

  for (const c of secrets.lenient) {
    it(`lenient ${JSON.stringify(c.secret.slice(0, 30))} → ${c.bytes}`, () => {
      expect(parseWebhookSecret(c.secret)?.length ?? null).toBe(c.bytes);
    });
  }
});
