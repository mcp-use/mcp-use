import { describe, expect, it } from "vitest";
import {
  dueForRemoval,
  writeCatalogAtStart,
  type CatalogMissing,
  type CatalogStore,
} from "../../../src/events/engine/catalog-lifecycle.js";
import type { CatalogRecord } from "../../../src/events/internal/records.js";
import { event, registry } from "./fixtures.js";

function store(initial: CatalogRecord | null = null) {
  let record = initial;
  let version = initial ? "1" : null;
  let missing: CatalogMissing = {};
  const s: CatalogStore = {
    async read() {
      return { record, version };
    },
    async write(r, v) {
      if (v !== version) return false;
      record = r;
      version = String(Number(version ?? 0) + 1);
      return true;
    },
    async readMissing() {
      return missing;
    },
    async writeMissing(m) {
      missing = m;
    },
  };
  return { s, get: () => ({ record, missing }) };
}

describe("catalog lifecycle (D32)", () => {
  it("writes the record, marks removed events missing and reports schema changes", async () => {
    const st = store({
      v: 1,
      hash: "old",
      writtenAt: 0,
      events: {
        a: { schemaHash: "h0", replay: true, hooks: { onSubscribe: false, onUnsubscribe: false } },
        gone: { schemaHash: "h", replay: true, hooks: { onSubscribe: false, onUnsubscribe: false } },
      },
    });
    const diff = await writeCatalogAtStart(st.s, registry(event("a")), 1000);
    expect([diff.missing, diff.schemaChanged]).toEqual([["gone"], ["a"]]);
    expect(st.get().record?.events).toEqual({
      a: { schemaHash: "h", replay: true, hooks: { onSubscribe: false, onUnsubscribe: false } },
    });
    expect(st.get().missing).toEqual({ gone: 1000 });
  });

  it("keeps the first missing time across restarts and clears returning events", async () => {
    const st = store();
    await st.s.writeMissing({ gone: 5, back: 5 });
    await writeCatalogAtStart(st.s, registry(event("back")), 9000);
    expect(st.get().missing).toEqual({ gone: 5 });
  });

  it("removes events missing for 24 h", () => {
    expect(dueForRemoval({ old: 0, fresh: 1000 }, 86_400_000)).toEqual(["old"]);
  });
});
