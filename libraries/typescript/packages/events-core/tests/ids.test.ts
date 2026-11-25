import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  deriveDirectId,
  deriveSubscriptionId,
  normalizeArguments,
  normalizeEventIdHeaderSafe,
  SUBSCRIPTION_ID_PATTERN,
} from "../src/index.js";
import { readVector } from "./vectors.js";

interface IdVectors {
  subscriptionIds: Array<{
    vector: string;
    principal: string;
    url: string;
    name: string;
    arguments?: unknown;
    canonicalKey: string;
    id: string;
  }>;
  directIds: Array<{
    vector: string;
    principal: string;
    name: string;
    arguments?: unknown;
    id: string;
  }>;
}

const ids = readVector<IdVectors>("subscription-ids.json");

describe("subscription ids equal PR #3209's (vectors/subscription-ids.json)", () => {
  it("has the twelve shared vectors", () => {
    expect(ids.subscriptionIds.map((v) => v.vector)).toEqual([
      "args-absent",
      "args-null",
      "args-empty",
      "args-flat",
      "key-order-a",
      "key-order-b",
      "nested-key-order",
      "non-ascii-keys",
      "negative-zero",
      "large-numbers",
      "anonymous-unicode",
      "direct-url",
    ]);
  });

  for (const v of ids.subscriptionIds) {
    it(`${v.vector}: derives ${v.id}`, async () => {
      const key =
        "arguments" in v
          ? {
              principal: v.principal,
              url: v.url,
              name: v.name,
              arguments: v.arguments,
            }
          : { principal: v.principal, url: v.url, name: v.name };
      expect(await deriveSubscriptionId(key)).toBe(v.id);
      expect(
        canonicalJson([
          v.principal,
          v.url,
          v.name,
          normalizeArguments(v.arguments),
        ])
      ).toBe(v.canonicalKey);
      expect(v.id).toMatch(SUBSCRIPTION_ID_PATTERN);
    });
  }

  it("keeps -0 in the parsed vector, so the -0 case is really exercised", () => {
    const v = ids.subscriptionIds.find((x) => x.vector === "negative-zero");
    expect(
      Object.is((v?.arguments as { threshold: number }).threshold, -0)
    ).toBe(true);
  });

  for (const v of ids.directIds) {
    it(`direct id ${v.vector}: derives ${v.id}`, async () => {
      const key =
        "arguments" in v
          ? { principal: v.principal, name: v.name, arguments: v.arguments }
          : { principal: v.principal, name: v.name };
      expect(await deriveDirectId(key)).toBe(v.id);
    });
  }

  it("a direct id differs from the webhook id of the same principal, name and arguments", async () => {
    const webhook = await deriveSubscriptionId({
      principal: "https://auth.example.com|user_123",
      url: "https://hooks.example.com/mcp/events",
      name: "note.created",
      arguments: { folder: "inbox" },
    });
    expect(webhook).toBe("sub_Iq5lpyGFq-fw8XHkVwXohH");
    expect(
      await deriveDirectId({
        principal: "https://auth.example.com|user_123",
        name: "note.created",
        arguments: { folder: "inbox" },
      })
    ).toBe("sub_ccDpyr1ulXpVGBD4K6o0sY");
  });
});

describe("canonicalJson (vectors/canonical-json.json)", () => {
  const cj = readVector<{
    cases: Array<{ case: string; input: unknown; canonical: string }>;
  }>("canonical-json.json");

  for (const c of cj.cases) {
    it(`${c.case}`, () => {
      expect(canonicalJson(c.input)).toBe(c.canonical);
    });
  }

  it("applies JSON.stringify rules first: toJSON, dropped members, non-finite numbers", () => {
    const value = {
      when: new Date("2026-11-25T10:00:00.000Z"),
      skip: undefined,
      fn: () => 1,
      nan: Number.NaN,
      inf: Number.POSITIVE_INFINITY,
      list: [undefined, () => 1],
    };
    expect(canonicalJson(value)).toBe(
      '{"inf":null,"list":[null,null],"nan":null,"when":"2026-11-25T10:00:00.000Z"}'
    );
  });

  it("throws TypeError for a value with no JSON text", () => {
    expect(() => canonicalJson(undefined)).toThrow(TypeError);
    expect(() => canonicalJson(() => 1)).toThrow(TypeError);
  });
});

describe("normalizeArguments", () => {
  it("turns absent and null into {} and keeps other values", () => {
    expect(normalizeArguments(undefined)).toEqual({});
    expect(normalizeArguments(null)).toEqual({});
    expect(normalizeArguments({ a: 1 })).toEqual({ a: 1 });
  });
});

describe("eventId header-safe normalization (vectors/event-id-normalization.json)", () => {
  const ev = readVector<{
    cases: Array<{ input: string; headerSafe: string }>;
  }>("event-id-normalization.json");
  for (const c of ev.cases) {
    it(`${JSON.stringify(c.input).slice(0, 40)} → ${c.headerSafe.slice(0, 40)}`, async () => {
      expect(await normalizeEventIdHeaderSafe(c.input)).toBe(c.headerSafe);
    });
  }
});
