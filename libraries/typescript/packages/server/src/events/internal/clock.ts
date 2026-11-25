/**
 * Injected time, scheduler and RNG seam used by every engine module and test.
 *
 * @internal
 */

/** Time, timers and randomness. */
export interface Clock {
  /** Current epoch ms. */
  now(): number;
  /** Schedule `fn` after `ms`; returns a cancel function. */
  setTimeout(fn: () => void, ms: number): () => void;
  /** Fill `n` random bytes. */
  randomBytes(n: number): Uint8Array;
  /** A float in [0, 1). */
  random(): number;
}

/** The real clock. */
export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout(fn, ms) {
    const t = setTimeout(fn, ms);
    (t as { unref?: () => void }).unref?.();
    return () => clearTimeout(t);
  },
  randomBytes(n) {
    const b = new Uint8Array(n);
    globalThis.crypto.getRandomValues(b);
    return b;
  },
  random: () => Math.random(),
};

/** A manual clock for tests: time moves only on `advance`. */
export interface ManualClock extends Clock {
  /** Move time forward, firing due timers in order. */
  advance(ms: number): Promise<void>;
  /** Pending timer count. */
  pending(): number;
}

/**
 * Create a deterministic clock. RNG is a seeded xorshift32.
 *
 * @param start - Initial epoch ms.
 * @param seed - RNG seed (non-zero).
 */
export function createManualClock(start = 0, seed = 0x9e3779b9): ManualClock {
  let now = start;
  let state = seed >>> 0 || 1;
  let nextId = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const next = (): number => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  };
  return {
    now: () => now,
    setTimeout(fn, ms) {
      const id = nextId++;
      timers.set(id, { at: now + Math.max(0, ms), fn });
      return () => void timers.delete(id);
    },
    randomBytes(n) {
      const b = new Uint8Array(n);
      for (let i = 0; i < n; i++) b[i] = next() & 0xff;
      return b;
    },
    random: () => next() / 0x1_0000_0000,
    async advance(ms) {
      const target = now + ms;
      for (;;) {
        let dueId: number | undefined;
        let dueAt = Infinity;
        for (const [id, t] of timers)
          if (t.at <= target && t.at < dueAt) {
            dueAt = t.at;
            dueId = id;
          }
        if (dueId === undefined) break;
        const t = timers.get(dueId)!;
        timers.delete(dueId);
        now = t.at;
        t.fn();
        await Promise.resolve();
      }
      now = target;
    },
    pending: () => timers.size,
  };
}
