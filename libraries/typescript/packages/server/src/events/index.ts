/**
 * MCP Events storage adapters: `memoryEventsStore` (development, tests) and
 * `upstashEventsStore` (Redis over the Upstash REST protocol).
 *
 * @packageDocumentation
 */

export {
  memoryEventsStore,
  upstashEventsStore,
  type EventsStore,
  type UpstashEventsStoreOptions,
} from "./store.js";
