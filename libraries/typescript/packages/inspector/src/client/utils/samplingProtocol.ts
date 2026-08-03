import type {
  JSONRPCMessage,
  McpServer,
  Transport,
} from "@mcp-use/client/react";

const CLIENT_CAPABILITIES_META_KEY =
  "io.modelcontextprotocol/clientCapabilities";

export const STATELESS_SAMPLING_UNSUPPORTED_MESSAGE =
  "Sampling is not supported by the stateless MCP protocol (2026-07-28).";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Sampling in the Inspector is the legacy server-to-client reverse-RPC
 * feature. Modern MCP uses stateless input_required exchanges instead, so the
 * Inspector must not claim the legacy capability in modern metadata.
 */
export function stripModernSamplingCapability(
  message: JSONRPCMessage
): JSONRPCMessage {
  const messageRecord = message as unknown as Record<string, unknown>;
  const params = messageRecord.params;
  if (!isRecord(params)) return message;

  const meta = params._meta;
  if (!isRecord(meta)) return message;

  const capabilities = meta[CLIENT_CAPABILITIES_META_KEY];
  if (!isRecord(capabilities) || !Object.hasOwn(capabilities, "sampling")) {
    return message;
  }

  const { sampling: _sampling, ...modernCapabilities } = capabilities;

  return {
    ...messageRecord,
    params: {
      ...params,
      _meta: {
        ...meta,
        [CLIENT_CAPABILITIES_META_KEY]: modernCapabilities,
      },
    },
  } as unknown as JSONRPCMessage;
}

/**
 * Preserve sampling in the legacy initialize capability object while removing
 * it from modern server/discover and per-request metadata envelopes.
 */
export function wrapTransportForLegacySampling(
  transport: Transport
): Transport {
  const wrapper: Transport = {
    get sessionId() {
      return transport.sessionId;
    },
    set sessionId(value: string | undefined) {
      transport.sessionId = value;
    },
    setProtocolVersion: transport.setProtocolVersion
      ? (version: string) => transport.setProtocolVersion?.(version)
      : undefined,
    async start() {
      return transport.start();
    },
    async send(message, options) {
      return transport.send(stripModernSamplingCapability(message), options);
    },
    async close() {
      return transport.close();
    },
    onclose: undefined,
    onerror: undefined,
    onmessage: undefined,
  };

  Object.defineProperties(wrapper, {
    onmessage: {
      configurable: true,
      enumerable: true,
      get: () => transport.onmessage,
      set: (handler: Transport["onmessage"]) => {
        transport.onmessage = handler;
      },
    },
    onclose: {
      configurable: true,
      enumerable: true,
      get: () => transport.onclose,
      set: (handler: Transport["onclose"]) => {
        transport.onclose = handler;
      },
    },
    onerror: {
      configurable: true,
      enumerable: true,
      get: () => transport.onerror,
      set: (handler: Transport["onerror"]) => {
        transport.onerror = handler;
      },
    },
  });

  return wrapper;
}

export function isInspectorSamplingAvailable(
  server: Pick<McpServer, "protocolEra">
): boolean {
  return server.protocolEra !== "modern";
}
