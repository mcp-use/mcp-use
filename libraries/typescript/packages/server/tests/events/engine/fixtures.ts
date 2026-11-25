/** Shared fixtures of the WP-17/18/19 engine and responder tests. */
import type { CursorCodec } from "../../../src/events/engine/poll.js";
import type { LogValue } from "../../../src/events/internal/records.js";
import type { RegisteredEvent } from "../../../src/events/internal/registry.js";

/** A log with real seq/epoch/first/head semantics and trimming. */
export function memoryLog() {
  const logs = new Map<string, Array<{ seq: number; value: LogValue }>>();
  const heads = new Map<string, number>();
  return {
    epoch: "e1",
    append(name: string, value: LogValue): number {
      const seq = (heads.get(name) ?? 0) + 1;
      heads.set(name, seq);
      const l = logs.get(name) ?? [];
      l.push({ seq, value });
      logs.set(name, l);
      return seq;
    },
    trim(name: string, before: number) {
      logs.set(name, (logs.get(name) ?? []).filter((e) => e.seq >= before));
    },
    async readLog(name: string, after: number | null, o: { limit: number }) {
      const l = logs.get(name) ?? [];
      const head = heads.get(name) ?? 0;
      const first = l.length > 0 ? l[0]!.seq : head + 1;
      const entries =
        after === null ? [] : l.filter((e) => e.seq > after).slice(0, o.limit);
      return { entries, epoch: "e1", first, head };
    },
    async isRevoked() {
      return false;
    },
  };
}

export const codec: CursorCodec = {
  async encode(_n, epoch, seq) {
    return `c.${epoch}.${seq}`;
  },
  async resolve(_n, cursor, o) {
    const [, epoch, seq] = cursor.split(".");
    if (epoch !== "e1") return { epoch: "e1", seq: 0, reset: true, floor: null };
    return {
      epoch,
      seq: Number(seq),
      reset: false,
      floor: o.maxAgeMs !== undefined ? o.now - o.maxAgeMs : null,
    };
  },
};

export function event(
  name: string,
  o: Partial<RegisteredEvent> & { definition?: Partial<RegisteredEvent["definition"]> } = {}
): RegisteredEvent {
  return {
    name,
    inputJsonSchema: {},
    payloadJsonSchema: {},
    schemaHash: "h",
    replay: { maxAgeMs: 3_600_000, maxEvents: 1000 },
    partitionBy: null,
    hooks: { onSubscribe: false, onUnsubscribe: false },
    async validatePayload(d) {
      return d;
    },
    async match(args, data) {
      return Object.entries(args).every(
        ([k, v]) => (data as Record<string, unknown>)[k] === v
      );
    },
    async runOnUnsubscribe() {},
    ...o,
    definition: { name, description: "d", payloadSchema: {} as never, ...o.definition } as RegisteredEvent["definition"],
  };
}

export function registry(...events: RegisteredEvent[]) {
  return {
    size: events.length,
    get: (n: string) => events.find((e) => e.name === n),
    all: () => events,
    catalogHash: "cat1",
  };
}

