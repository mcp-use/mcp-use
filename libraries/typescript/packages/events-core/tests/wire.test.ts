import { describe, expect, it } from "vitest";
import {
  DIALECT_RESPONSE_HEADER,
  EVENTS_EXTENSION_ID,
  EVENTS_METHODS,
  EVENTS_NOTIFICATIONS,
  LEGACY_EVENTS_CAPABILITY,
  MAX_ENVELOPE_BYTES,
  SDK_NO_EXPIRY,
  SUBSCRIPTION_ID_HEADER,
  SUBSCRIPTION_ID_META_KEY,
  toSdkWebhookRecord,
} from "../src/index.js";
import { readVector, STANDARD_WEBHOOKS_TEST_SECRET } from "./vectors.js";

describe("wire constants", () => {
  it("match SEP-3415 and PR #3209", () => {
    expect({
      EVENTS_EXTENSION_ID,
      LEGACY_EVENTS_CAPABILITY,
      SUBSCRIPTION_ID_HEADER,
      SUBSCRIPTION_ID_META_KEY,
      DIALECT_RESPONSE_HEADER,
      MAX_ENVELOPE_BYTES,
    }).toEqual({
      EVENTS_EXTENSION_ID: "io.modelcontextprotocol/events",
      LEGACY_EVENTS_CAPABILITY: "events",
      SUBSCRIPTION_ID_HEADER: "X-MCP-Subscription-Id",
      SUBSCRIPTION_ID_META_KEY: "io.modelcontextprotocol/subscriptionId",
      DIALECT_RESPONSE_HEADER: "x-mcp-use-events-dialect",
      MAX_ENVELOPE_BYTES: 262144,
    });
    expect(Object.values(EVENTS_METHODS)).toEqual([
      "events/list",
      "events/subscribe",
      "events/unsubscribe",
      "events/poll",
      "events/stream",
    ]);
    expect(Object.values(EVENTS_NOTIFICATIONS)).toEqual([
      "notifications/events/active",
      "notifications/events/event",
      "notifications/events/heartbeat",
      "notifications/events/error",
      "notifications/events/terminated",
      "notifications/events/list_changed",
    ]);
  });
});

describe("toSdkWebhookRecord", () => {
  const record = {
    id: "sub_-lLcGdzxg6RinEWMMBmS7T",
    principal: "https://auth.example.com|user_123",
    name: "note.created",
    args: { folder: "inbox" },
    url: "https://hooks.example.com/mcp/events",
    secret: STANDARD_WEBHOOKS_TEST_SECRET,
    previousSecret: {
      secret: "whsec_AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
      expiresAt: 1764000600000,
    },
    expiresAt: 1764086400000,
    createdAt: 1764000000000,
    profile: { preset: "sep-3415", revision: 1 },
    v: 1,
  };

  it("projects onto the nine fields of #3209's WebhookSubscriptionRecord", () => {
    expect(toSdkWebhookRecord(record)).toEqual({
      id: "sub_-lLcGdzxg6RinEWMMBmS7T",
      principal: "https://auth.example.com|user_123",
      name: "note.created",
      arguments: { folder: "inbox" },
      url: "https://hooks.example.com/mcp/events",
      secret: STANDARD_WEBHOOKS_TEST_SECRET,
      previousSecret: {
        secret: "whsec_AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
        expiresAt: 1764000600000,
      },
      expiresAt: 1764086400000,
      createdAt: 1764000000000,
    });
  });

  it("maps no expiry to SDK_NO_EXPIRY, omits an absent previous secret and copies arguments", () => {
    const { previousSecret: _drop, ...noRotation } = record;
    const out = toSdkWebhookRecord({ ...noRotation, expiresAt: null });
    expect([out.expiresAt, "previousSecret" in out]).toEqual([
      Number.MAX_SAFE_INTEGER,
      false,
    ]);
    expect(SDK_NO_EXPIRY).toBe(Number.MAX_SAFE_INTEGER);
    out.arguments.folder = "archive";
    expect(record.args).toEqual({ folder: "inbox" });
  });
});

describe("vectors/cursor-format.json", () => {
  const v = readVector<{ pattern: string; valid: string[]; invalid: string[] }>(
    "cursor-format.json"
  );
  const pattern = new RegExp(v.pattern);

  it("the pattern accepts every valid cursor and rejects every invalid one", () => {
    expect(v.valid.filter((c) => !pattern.test(c))).toEqual([]);
    expect(v.invalid.filter((c) => pattern.test(c))).toEqual([]);
  });
});
