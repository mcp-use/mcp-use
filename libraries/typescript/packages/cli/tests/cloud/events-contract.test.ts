import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CLOUD_EVENTS_OPERATIONS,
  type CloudEventsResponses,
} from "../../src/cloud/events/contract.js";

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`../fixtures/events/${name}`, import.meta.url), "utf8")
  );

const SUBSCRIPTION_KEYS = [
  "args",
  "callbackOrigin",
  "createdAt",
  "era",
  "expiresAt",
  "id",
  "mode",
  "name",
  "partition",
  "principal",
  "profile",
  "refreshedAt",
  "status",
  "watermark",
];
const DEAD_LETTER_KEYS = [
  "abandonedAt",
  "attempts",
  "bodyBytes",
  "callbackOrigin",
  "eventId",
  "id",
  "kind",
  "lastError",
  "name",
  "reason",
  "subscriptionId",
  "webhookId",
];
const STATUS_KEYS = [
  "binding",
  "closed",
  "deadLetters",
  "due",
  "fanoutDue",
  "layout",
  "leases",
  "namespaceHash",
  "nextWakeAt",
  "oldestDueAgeMs",
  "subscriptions",
  "updatedAt",
];

/** Required keys of each response, from the contract types. */
const REQUIRED: { [K in keyof CloudEventsResponses]: string[] } = {
  status: STATUS_KEYS,
  catalog: ["active", "diff", "manifest", "missing"],
  subscriptions: ["items"],
  subscription: [...SUBSCRIPTION_KEYS, "attempts"].sort(),
  deliveries: ["items"],
  deadLetters: ["items"],
  redeliver: ["jobId"],
  revoke: ["removed"],
  emit: ["accepted", "duplicate", "eventId"],
  purge: ["deletedKeys", "hooks", "purged", "terminated", "undelivered"],
  egress: ["ranges", "updatedAt"],
};

const hasKeys = (value: unknown, keys: string[]): string[] =>
  keys.filter((k) => !(k in (value as Record<string, unknown>)));

describe("Cloud events API contract", () => {
  it("cloud-api.json lists exactly the operations of contract.ts", () => {
    const api = JSON.parse(
      readFileSync(
        new URL("../../../../contracts/events/cloud-api.json", import.meta.url),
        "utf8"
      )
    ) as { base: string; operations: unknown[] };
    expect(api.base).toBe("/servers/{id}/events");
    expect(api.operations).toEqual(
      CLOUD_EVENTS_OPERATIONS.map((op) => ({ ...op }))
    );
  });

  it.each(CLOUD_EVENTS_OPERATIONS.map((op) => [op.id, op.fixture]))(
    "%s fixture round-trips and carries every required field",
    (id, file) => {
      const body = fixture(file);
      expect(JSON.parse(JSON.stringify(body))).toEqual(body);
      const required = REQUIRED[id as keyof CloudEventsResponses];
      expect(hasKeys(body, required)).toEqual([]);
      const items = (body as { items?: unknown[] }).items;
      if (id === "subscriptions") {
        expect(hasKeys(items![0], SUBSCRIPTION_KEYS)).toEqual([]);
      }
      if (id === "deadLetters") {
        expect(hasKeys(items![0], DEAD_LETTER_KEYS)).toEqual([]);
        expect("body" in (items![0] as object)).toBe(false);
      }
    }
  );

  it("the user-binding status nulls every state field", () => {
    const body = fixture("status-user-binding.json") as Record<string, unknown>;
    expect(hasKeys(body, STATUS_KEYS)).toEqual([]);
    expect(body["binding"]).toBe("user");
    expect(body["due"]).toBeNull();
    expect(body["message"]).toBe("Events state is in your own storage");
  });
});
