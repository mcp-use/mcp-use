/**
 * Manufact analytics for MCP servers you host yourself. One
 * {@link instrument} call records an event per JSON-RPC request and sends it
 * to Manufact in the background, where it powers the same Analytics,
 * Sessions and Gateway Requests views as traffic through the Manufact
 * gateway.
 *
 * @packageDocumentation
 */

export { flush, instrument, shutdown } from "./instrument.js";
export type {
  ActorIdentity,
  AnalyticsActor,
  AnalyticsBatch,
  AnalyticsClientInfo,
  AnalyticsEvent,
  AnalyticsHttpInfo,
  AnalyticsOpenAiInfo,
  AnalyticsOptions,
  AnalyticsRequestContext,
  AnalyticsSdkInfo,
  Framework,
  Outcome,
  RemoteConfig,
  Transport,
} from "./types.js";
