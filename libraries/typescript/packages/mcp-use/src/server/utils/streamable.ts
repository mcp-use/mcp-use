/**
 * Streamable value primitive for incremental widget prop updates.
 *
 * Creates an observable value that can be updated from a tool handler and
 * pushed to the widget in real-time via `mcp-use/notifications/props-update`.
 *
 * Inspired by Vercel AI SDK's `createStreamableValue()`.
 *
 * @example
 * ```ts
 * import { streamable, text } from "mcp-use";
 *
 * server.tool({ name: "analyze", schema: z.object({ text: z.string() }) },
 *   async ({ text: input }, ctx) => {
 *     const analysis = streamable("");
 *     (async () => {
 *       for await (const chunk of analyzeStream(input)) {
 *         analysis.update(prev => prev + chunk);
 *       }
 *       analysis.done();
 *     })();
 *     return widget({ props: { text: input, analysis }, output: text("Done") });
 *   }
 * );
 * ```
 */

const STREAMABLE_BRAND = Symbol.for("mcp-use:streamable");

/**
 * A streamable value that pushes incremental updates to the widget.
 *
 * At creation, holds an initial value. Call `.update()` to push new values
 * to any subscribers. Call `.done()` when streaming is complete.
 *
 * The `widget()` helper detects `Streamable` values in props and:
 * 1. Subscribes to updates, forwarding them via `ctx.sendNotification()`
 * 2. Replaces the streamable with its `.current` value for the initial `structuredContent`
 */
export interface Streamable<T> {
  /** Current value (synchronous). */
  readonly current: T;
  /** Resolves to the final value after `.done()` is called. */
  readonly value: Promise<T>;
  /** Push a new value. Accepts either a value or an updater function. */
  update(updater: T | ((prev: T) => T)): void;
  /** Signal that streaming is complete. Resolves the `.value` promise. */
  done(): void;
  /** @internal Brand for runtime detection. */
  readonly [STREAMABLE_BRAND]: true;
  /** @internal Subscribe to value changes. */
  _subscribe(fn: (value: T) => void): void;
  /** @internal Unsubscribe all listeners. */
  _unsubscribeAll(): void;
}

/**
 * Check if a value is a Streamable instance.
 */
export function isStreamable(value: unknown): value is Streamable<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as any)[STREAMABLE_BRAND] === true
  );
}

/**
 * Create a streamable value for incremental widget prop updates.
 *
 * @param initial - Initial value
 * @returns A `Streamable<T>` that can be updated and subscribed to
 *
 * @example
 * ```ts
 * const analysis = streamable("");
 * analysis.update("partial result...");
 * analysis.update(prev => prev + " more data");
 * analysis.done();
 * const final = await analysis.value; // "partial result... more data"
 * ```
 */
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
