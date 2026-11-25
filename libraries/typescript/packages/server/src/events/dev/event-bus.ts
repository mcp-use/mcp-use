/**
 * The CLI→app event bus contract (D44, D77). `@mcp-use/cli` compiles in its
 * own SDK copy, which can differ from the app's, so the bus crosses the
 * package boundary as this structural interface, owned by `mcp-use`. The
 * CLI never passes an SDK class; `mcp-use` adapts whatever object it gets.
 *
 * @internal
 */

/**
 * A change event carried by the dev bus. Only `type` is read structurally;
 * every other field is forwarded unchanged.
 */
export interface McpUseBusEvent {
  /** Event discriminator, e.g. `"tools/list_changed"`. */
  readonly type?: string;
  readonly [field: string]: unknown;
}

/**
 * The structural event bus the CLI hands to every server generation. Any
 * object with these two methods qualifies, including an SDK
 * `InMemoryServerEventBus` from a different SDK version.
 */
export interface McpUseEventBus<E = McpUseBusEvent> {
  /** Publish a change event to every registered listener. */
  publish(event: E): void;
  /** Register a listener; returns an idempotent unsubscribe function. */
  subscribe(listener: (event: E) => void): () => void;
}

/** Whether `value` satisfies {@link McpUseEventBus} structurally. */
export function isMcpUseEventBus(value: unknown): value is McpUseEventBus {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<McpUseEventBus>;
  return (
    typeof candidate.publish === "function" &&
    typeof candidate.subscribe === "function"
  );
}

/**
 * Adapt a bus received from the CLI. The result never exposes the source
 * object's other members, binds `this`, makes unsubscribe idempotent and
 * isolates a throwing listener from the publisher.
 *
 * @throws TypeError when `value` lacks `publish` or `subscribe`.
 */
export function adaptEventBus<E = McpUseBusEvent>(
  value: unknown,
  onListenerError?: (error: unknown) => void
): McpUseEventBus<E> {
  if (!isMcpUseEventBus(value)) {
    throw new TypeError(
      "The dev event bus must have publish(event) and subscribe(listener) methods."
    );
  }
  const source = value as unknown as McpUseEventBus<E>;
  return {
    publish(event) {
      source.publish(event);
    },
    subscribe(listener) {
      const unsubscribe = source.subscribe((event) => {
        try {
          listener(event);
        } catch (error) {
          onListenerError?.(error);
        }
      });
      let done = false;
      return () => {
        if (done) return;
        done = true;
        if (typeof unsubscribe === "function") unsubscribe();
      };
    },
  };
}
