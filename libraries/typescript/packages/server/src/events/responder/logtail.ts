/**
 * `LogTail` (D52, PLAN.md §8.16): cross-instance push fan-in. One tail per
 * process (per stream on workerd) reads each followed log from its last
 * position and offers new entries to registered readers. It wakes on the
 * storage `signal` or by polling (1 s shared; 3 s per stream). The log is the
 * truth: a lost wake costs latency, never events.
 *
 * @internal
 */

import { EVENTS_DEFAULTS } from "../config.js";
import type { EventsBackend } from "../internal/backend.js";
import type { Clock } from "../internal/clock.js";
import type { LogValue } from "../internal/records.js";

/** One log entry as the tail offers it. */
export interface TailEntry {
  seq: number;
  value: LogValue;
}

/** A registered reader of one event log. */
export interface TailReader {
  /** Called with entries in seq order, never twice for one seq. */
  onEntries(epoch: string | null, entries: readonly TailEntry[]): void;
  /** The log was trimmed or reset under the tail: entries before `first` were lost. */
  onGap(epoch: string | null, first: number): void;
  /** A transient storage error. */
  onError(err: unknown): void;
}

interface Followed {
  epoch: string | null;
  pos: number | null;
  readers: Set<TailReader>;
}

/** Options of {@link LogTail}. */
export interface LogTailOptions {
  backend: Pick<EventsBackend, "readLog">;
  clock: Pick<Clock, "setTimeout">;
  /** Polling interval; default 1 s (shared). */
  intervalMs?: number;
  /** Entries per read. */
  pageSize?: number;
}

/** The shared tail. */
export class LogTail {
  readonly #o: Required<Omit<LogTailOptions, "backend" | "clock">> & LogTailOptions;
  readonly #logs = new Map<string, Followed>();
  #cancel: (() => void) | null = null;
  #running: Promise<void> | null = null;
  #again = false;
  #closed = false;

  /** @param o - Backend, clock and polling options. */
  constructor(o: LogTailOptions) {
    this.#o = {
      intervalMs: EVENTS_DEFAULTS.tailSharedMs,
      pageSize: 200,
      ...o,
    };
  }

  /** Number of registered readers. */
  get readers(): number {
    let n = 0;
    for (const f of this.#logs.values()) n += f.readers.size;
    return n;
  }

  /**
   * Registers a reader of `name`. The reader receives every entry appended
   * after the tail's current position for that log; on first follow the
   * position is the head read now, so callers catch up to at least that head
   * before trusting live entries (they drop `seq ≤ pos`).
   *
   * @returns The tail's position for the log at registration and an unregister function.
   */
  async register(
    name: string,
    reader: TailReader
  ): Promise<{ epoch: string | null; head: number; unregister: () => void }> {
    let f = this.#logs.get(name);
    if (!f) {
      f = { epoch: null, pos: null, readers: new Set() };
      this.#logs.set(name, f);
    }
    f.readers.add(reader);
    if (f.pos === null) {
      const h = await this.#o.backend.readLog(name, null, { limit: 0 });
      if (f.pos === null) {
        f.pos = h.head;
        f.epoch = h.epoch;
      }
    }
    this.#schedule();
    const followed = f;
    return {
      epoch: f.epoch,
      head: f.pos,
      unregister: () => {
        followed.readers.delete(reader);
        if (followed.readers.size === 0) this.#logs.delete(name);
        if (this.#logs.size === 0) this.#stopTimer();
      },
    };
  }

  /** Wakes the tail now (storage signal or a local emit). */
  signal(): void {
    if (this.#closed) return;
    if (this.#running) {
      this.#again = true;
      return;
    }
    this.#running = this.#readAll().finally(() => {
      this.#running = null;
      if (this.#again) {
        this.#again = false;
        this.signal();
      } else this.#schedule();
    });
  }

  /** Runs one read pass over every followed log (tests and drivers). */
  async poll(): Promise<void> {
    if (this.#running) await this.#running;
    await this.#readAll();
  }

  /** Stops the timer; readers stay registered but receive nothing more. */
  close(): void {
    this.#closed = true;
    this.#stopTimer();
  }

  #stopTimer(): void {
    this.#cancel?.();
    this.#cancel = null;
  }

  #schedule(): void {
    if (this.#closed || this.#cancel || this.#logs.size === 0) return;
    this.#cancel = this.#o.clock.setTimeout(() => {
      this.#cancel = null;
      this.signal();
    }, this.#o.intervalMs);
  }

  async #readAll(): Promise<void> {
    this.#stopTimer();
    for (const [name, f] of [...this.#logs]) {
      if (f.pos === null) continue;
      try {
        for (;;) {
          const page = await this.#o.backend.readLog(name, f.pos, {
            limit: this.#o.pageSize,
          });
          if (page.epoch !== f.epoch || page.first > f.pos + 1) {
            f.epoch = page.epoch;
            for (const r of f.readers) r.onGap(page.epoch, page.first);
            f.pos = page.first - 1;
            if (page.entries.length === 0) continue;
          }
          if (page.entries.length === 0) break;
          const fresh = page.entries.filter((e) => e.seq > f.pos!);
          f.pos = page.entries[page.entries.length - 1]!.seq;
          if (fresh.length > 0)
            for (const r of f.readers) r.onEntries(f.epoch, fresh);
          if (page.entries.length < this.#o.pageSize) break;
        }
      } catch (err) {
        for (const r of f.readers) r.onError(err);
      }
    }
  }
}
