/**
 * The registry interface the engine uses to reach definitions and hooks.
 * Implemented by WP-23 (`events/registry.ts`).
 *
 * @internal
 */

import type {
  AnyEventDefinition,
  MatchContext,
  UnsubscribeReason,
  SubscriptionInfo,
} from "../types.js";

/** A registered event as the engine sees it. */
export interface RegisteredEvent {
  readonly name: string;
  readonly definition: AnyEventDefinition;
  /** Advertised input JSON Schema. */
  readonly inputJsonSchema: Record<string, unknown>;
  /** Advertised payload JSON Schema. */
  readonly payloadJsonSchema: Record<string, unknown>;
  /** Hash of both schemas (catalog record). */
  readonly schemaHash: string;
  /** Resolved replay window, or false. */
  readonly replay: false | { maxAgeMs: number; maxEvents: number };
  /** Resolved partition key, or null. */
  readonly partitionBy: string | null;
  readonly hooks: { onSubscribe: boolean; onUnsubscribe: boolean };
  /** Validate a payload; throws EVENT_PAYLOAD_INVALID. */
  validatePayload(data: unknown): Promise<unknown>;
  /** Run match (auto or custom). */
  match(
    args: Record<string, unknown>,
    data: unknown,
    ctx: MatchContext
  ): Promise<boolean>;
  /** Run onUnsubscribe if defined. */
  runOnUnsubscribe(
    sub: SubscriptionInfo<Record<string, unknown>>,
    reason: UnsubscribeReason
  ): Promise<void>;
}

/** Read access to the process catalog. */
export interface EventsRegistry {
  /** Number of registered events (0 means Events is off: −32601). */
  readonly size: number;
  get(name: string): RegisteredEvent | undefined;
  all(): readonly RegisteredEvent[];
  /** Catalog hash over every event's schemaHash. */
  readonly catalogHash: string;
}
