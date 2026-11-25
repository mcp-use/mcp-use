import { describe, expect, it } from "vitest";
import { revoke } from "../../../src/events/engine/revoke.js";
import type { AppendItem, EventsBackend } from "../../../src/events/internal/backend.js";
import { event, registry } from "./fixtures.js";

function backend() {
  const appended: AppendItem[] = [];
  const filters: unknown[] = [];
  const b = {
    async revoke(f: unknown) {
      filters.push(f);
      return { removed: [] };
    },
    async append(items: readonly AppendItem[]) {
      appended.push(...items);
      return items.map((_, i) => ({ duplicate: false as const, seq: i + 1, epoch: "e1" }));
    },
  };
  return { appended, filters, backend: b as unknown as EventsBackend };
}

describe("revoke", () => {
  it("removes webhook subscriptions and writes a control entry per event for poll and push", async () => {
    const b = backend();
    const r = await revoke(
      { principal: "iss|alice" },
      { backend: b.backend, registry: registry(event("a"), event("b")), now: () => 42 }
    );
    expect(b.filters).toEqual([{ principal: "iss|alice" }]);
    expect(r.controlEntries).toEqual(["a", "b"]);
    expect(b.appended[0]).toEqual({
      name: "a",
      dedupeKey: null,
      value: {
        v: 1,
        k: "t",
        at: 42,
        to: { principals: ["iss|alice"] },
        error: { kind: "forbidden", message: "Forbidden", data: { reason: "revoked" } },
      },
    });
  });

  it("targets one event and one subscription id", async () => {
    const b = backend();
    await revoke(
      { subscriptionId: "sub_x", name: "b" },
      { backend: b.backend, registry: registry(event("a"), event("b")), now: () => 1 }
    );
    expect(b.appended.map((i) => [i.name, (i.value as { to: unknown }).to])).toEqual([["b", { subscriptionId: "sub_x" }]]);
  });

  it("refuses an unfiltered revoke", async () => {
    const b = backend();
    await expect(revoke({}, { backend: b.backend, registry: registry(), now: () => 1 })).rejects.toThrow(
      "revoke needs a principal or a subscriptionId"
    );
  });
});
