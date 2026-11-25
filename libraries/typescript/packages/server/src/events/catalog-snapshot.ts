/**
 * The build manifest's Events catalog (PLAN.md §11.5). `mcp-use build` reads
 * it through the duck-typed `__eventsCatalog()` hook on the server and writes
 * it to `.mcp-use/build/manifest.json` as `events`. The snapshot is computed
 * from definitions only: it never touches storage, so the inert build binding
 * (`MCP_USE_PHASE=build`) never creates a namespace.
 *
 * @internal
 */

import { canonicalJson } from "@mcp-use/events-core";
import type { EventsRegistry, RegisteredEvent } from "./internal/registry.js";

/** One event in {@link EventsCatalogSnapshot}. */
export interface EventsCatalogSnapshotEvent {
  /** Event name. */
  name: string;
  /** Event description. */
  description: string;
  /** Advertised input JSON Schema. */
  inputSchema: Record<string, unknown>;
  /** Advertised payload JSON Schema. */
  payloadSchema: Record<string, unknown>;
  /** Hash of both schemas, as in the catalog record. */
  schemaHash: string;
  /** Definition-level delivery modes; the listed modes are computed per profile at run time (D26). */
  delivery: { webhook: boolean; push: boolean; poll: boolean };
  /** Whether the event has a partition key. */
  partitioned: boolean;
  /** OAuth scopes, when declared. */
  scopes?: string[];
  /** Resolved replay window, or false. */
  replay: false | { maxAge: string; maxEvents: number };
  /** Which lifecycle hooks are defined. */
  hooks: { onSubscribe: boolean; onUnsubscribe: boolean };
}

/** `BuildManifest.events` (§11.5). */
export interface EventsCatalogSnapshot {
  /** Snapshot format version. */
  version: 1;
  /** Lower-case hex SHA-256 of `canonicalJson(events)`. */
  hash: string;
  /** Events sorted by name. */
  events: EventsCatalogSnapshotEvent[];
}

/**
 * Format milliseconds as the largest exact duration unit (`"10m"`, `"1d"`,
 * `"1500ms"`).
 *
 * @param ms - Non-negative integer milliseconds.
 * @returns A duration string accepted by the Events config parser.
 */
export function formatDurationMs(ms: number): string {
  const units: ReadonlyArray<[string, number]> = [
    ["d", 86_400_000],
    ["h", 3_600_000],
    ["m", 60_000],
    ["s", 1000],
  ];
  for (const [unit, size] of units) {
    if (ms >= size && ms % size === 0) return `${ms / size}${unit}`;
  }
  return `${ms}ms`;
}

function snapshotEvent(event: RegisteredEvent): EventsCatalogSnapshotEvent {
  const definition = event.definition;
  const delivery = definition.delivery ?? {};
  return {
    name: event.name,
    description: definition.description,
    inputSchema: event.inputJsonSchema,
    payloadSchema: event.payloadJsonSchema,
    schemaHash: event.schemaHash,
    delivery: {
      webhook: delivery.webhook !== false,
      push: delivery.push !== false,
      poll: delivery.poll !== false && event.replay !== false,
    },
    partitioned: event.partitionBy !== null,
    ...(definition.scopes !== undefined && definition.scopes.length > 0
      ? { scopes: [...definition.scopes] }
      : {}),
    replay:
      event.replay === false
        ? false
        : {
            maxAge: formatDurationMs(event.replay.maxAgeMs),
            maxEvents: event.replay.maxEvents,
          },
    hooks: { ...event.hooks },
  };
}

/**
 * Build the catalog snapshot from the process registry.
 *
 * @param registry - The registry of the server being built.
 * @returns The snapshot, or `undefined` when no event is registered.
 */
export async function eventsCatalogSnapshot(
  registry: Pick<EventsRegistry, "size" | "all">
): Promise<EventsCatalogSnapshot | undefined> {
  if (registry.size === 0) return undefined;
  const events = registry
    .all()
    .map(snapshotEvent)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(canonicalJson(events))
    )
  );
  const hash = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join(
    ""
  );
  return { version: 1, hash, events };
}
