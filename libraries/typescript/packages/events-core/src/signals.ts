/**
 * Request signals (D27): what a server observes about the client on an
 * `events/*` request. Profile resolution and the known-client table read them;
 * a projection is stored on every subscription.
 *
 * @packageDocumentation
 */

/** The protocol era of a request: `legacy` (`initialize`-based) or `modern` (2026-07-28 and later). */
export type ProtocolEra = "legacy" | "modern";

/** What a server observed about the client on one `events/*` request. */
export interface EventsSignals {
  /** The request's protocol era, as the SDK's inbound classifier decided it. */
  era: ProtocolEra;
  /** The protocol version the request carried, when known. */
  protocolVersion?: string;
  /** Whether the client declared `extensions["io.modelcontextprotocol/events"]` in its capabilities. */
  declaresEventsExtension: boolean;
  /** The client's `clientInfo`, when known (modern envelope, or the session's `initialize`). */
  clientInfo?: {
    /** `clientInfo.name`, for example `openai-mcp/1.0`. */
    name?: string;
    /** `clientInfo.version`. */
    version?: string;
  };
  /** The HTTP `User-Agent` header. */
  userAgent?: string;
  /** The `Mcp-Name` header: whether it was sent, and its sentinel-decoded value when decodable. */
  mcpName: {
    /** Whether the header was present. */
    present: boolean;
    /** The decoded value; absent when the header is missing or its sentinel does not decode. */
    value?: string;
  };
  /** Whether an `Mcp-Method` header was present. */
  mcpMethod?: boolean;
  /** The callback URL's host (`events/subscribe` and `events/unsubscribe` only). */
  callbackHost?: string;
  /** Dev only: the request arrived through the dev tunnel's public host. */
  viaTunnel?: boolean;
}
