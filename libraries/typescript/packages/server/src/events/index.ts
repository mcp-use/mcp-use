/**
 * MCP Events storage adapters: `memoryEventsStore` (tests), `fileEventsStore`
 * (local development) and `upstashEventsStore` (Redis over the Upstash REST
 * protocol).
 *
 * @packageDocumentation
 */

export {
  fileEventsStore,
  memoryEventsStore,
  upstashEventsStore,
  type EventsStore,
  type UpstashEventsStoreOptions,
} from "./store.js";
