/**
 * `defineEvent` and `createEventsEmitter` (§7.1). Skeleton owned by WP-23.
 *
 * @packageDocumentation
 */

import type { EventsConfig } from "./config.js";
import { EventsConfigError } from "./errors.js";
import { buildRegisteredEvent, createEventsRegistry } from "./registry.js";
import type {
  AnyEventDefinition,
  EmitOptions,
  EmitResult,
  EventDefinition,
  EventPayloadIn,
  EventSchema,
} from "./types.js";

/**
 * Share an event definition with a separate emitter process. Runs the same
 * synchronous registration checks as `server.event()`.
 *
 * @param definition - The event definition.
 */
export function defineEvent<
  const Name extends string,
  I extends EventSchema | undefined,
  P extends EventSchema,
>(definition: EventDefinition<Name, I, P>): EventDefinition<Name, I, P> {
  buildRegisteredEvent(definition as unknown as AnyEventDefinition);
  return definition;
}

/** An emitter for a process that serves no MCP. */
export interface EventsEmitter {
  /** Emit one occurrence of a shared definition. */
  emit<D extends AnyEventDefinition>(
    def: D,
    data: EventPayloadIn<D["payloadSchema"]>,
    options?: EmitOptions
  ): Promise<EmitResult>;
  /** Release the binding. */
  close(): Promise<void>;
}

/**
 * Emit from a process that serves no MCP, over the same store binding as the server (§8.5).
 *
 * @param options - Shared definitions and Events configuration.
 */
export function createEventsEmitter(options: {
  events: readonly AnyEventDefinition[];
  config?: EventsConfig;
}): EventsEmitter {
  const registry = createEventsRegistry({
    config: options.config as EventsConfig<any> | undefined, // eslint-disable-line @typescript-eslint/no-explicit-any
  });
  for (const def of options.events) registry.add(def);
  let closed = false;
  return {
    async emit(def, data) {
      if (closed) {
        throw new EventsConfigError(
          "EVENTS_BACKEND_UNAVAILABLE",
          "events: emitter is closed."
        );
      }
      const event = registry.get(def.name);
      if (event === undefined) {
        throw new EventsConfigError(
          "EVENTS_CONFIG_INVALID",
          `events: "${def.name}" is not one of this emitter's definitions.`,
          { name: def.name }
        );
      }
      await event.validatePayload(data);
      // TODO(events): resolve the store binding (WP-24) and append through engine/emit.ts (WP-20).
      throw new EventsConfigError(
        "EVENTS_BACKEND_UNAVAILABLE",
        "events: createEventsEmitter needs the Events engine binding, which is not built yet."
      );
    },
    async close() {
      closed = true;
    },
  };
}
