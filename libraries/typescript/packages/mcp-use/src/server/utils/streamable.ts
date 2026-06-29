/**
 * Streamable value primitive for incremental view prop updates.
 */

const STREAMABLE_BRAND = Symbol.for("mcp-use:streamable");

export interface Streamable<T> {
  readonly current: T;
  readonly value: Promise<T>;
  update(updater: T | ((prev: T) => T)): void;
  done(): void;
  readonly [STREAMABLE_BRAND]: true;
  _subscribe(fn: (value: T) => void): void;
  _unsubscribeAll(): void;
}

export function isStreamable(value: unknown): value is Streamable<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as any)[STREAMABLE_BRAND] === true
  );
}

export function streamable<T>(initial: T): Streamable<T> {
  let current = initial;
  let doneResolver: ((value: T) => void) | null = null;
  let isDone = false;
  const subscribers: Array<(value: T) => void> = [];

  const donePromise = new Promise<T>((resolve) => {
    doneResolver = resolve;
  });

  const instance: Streamable<T> = {
    get current() {
      return current;
    },

    get value() {
      return isDone ? Promise.resolve(current) : donePromise;
    },

    update(updater: T | ((prev: T) => T)) {
      if (isDone) return;
      current =
        typeof updater === "function"
          ? (updater as (prev: T) => T)(current)
          : updater;
      for (const fn of subscribers) {
        fn(current);
      }
    },

    done() {
      if (isDone) return;
      isDone = true;
      doneResolver?.(current);
    },

    [STREAMABLE_BRAND]: true as const,

    _subscribe(fn: (value: T) => void) {
      subscribers.push(fn);
    },

    _unsubscribeAll() {
      subscribers.length = 0;
    },
  };

  return instance;
}
