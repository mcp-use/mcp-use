/**
 * The `createMcpMount` preflight for `events/*` (§5.4 steps 1–7, D9, D75,
 * D87). It never touches a request that is not a single JSON-RPC request
 * whose method starts with `events/`, except to reject batches that contain
 * one.
 *
 * @internal
 */

import {
  EVENTS_EXTENSION_ID,
  HEADER_MISMATCH_CODE,
  INVALID_REQUEST_CODE,
  MCP_NAME_HEADER,
  checkParamHeaders,
} from "@mcp-use/events-core";
import type { EventsSignals, JsonRpcErrorObject } from "@mcp-use/events-core";
import type { EventsRegistry } from "./internal/registry.js";
import type {
  EventsResponderMethod,
  ResponderRequest,
} from "./responder/index.js";
import type { SdkEra, SdkEventsAdapter } from "./sdk-adapter.js";

const METHODS = new Set<string>([
  "events/list",
  "events/subscribe",
  "events/unsubscribe",
  "events/poll",
  "events/stream",
]);
const NAMED = new Set<string>([
  "events/subscribe",
  "events/unsubscribe",
  "events/poll",
  "events/stream",
]);

/** Options of {@link createEventsPreflight}. */
export interface PreflightOptions {
  /** The SDK seam. */
  sdk: SdkEventsAdapter;
  /** The catalog (for `x-mcp-header` declarations). */
  registry: EventsRegistry;
  /** `compatibility.mcpName`; default `"lenient"` (D9). */
  mcpName?: "lenient" | "strict" | undefined;
  /** Host/Origin allow-lists the mount applies. */
  allowedHosts?: string[] | undefined;
  /** Origin allow-list the mount applies. */
  allowedOrigins?: string[] | undefined;
  /** Dispatch to the responder. */
  dispatch(request: ResponderRequest): Promise<Response>;
  /** One WARN per client name for a missing header (lenient). */
  warn?(message: string): void;
  /** Record a `client_signals` log record (once per client name). */
  recordSignals?(signals: EventsSignals): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isEventsMethod(message: unknown): boolean {
  return (
    isRecord(message) &&
    typeof message.method === "string" &&
    message.method.startsWith("events/")
  );
}

function idOf(message: unknown): string | number | null {
  if (!isRecord(message)) return null;
  const id = message.id;
  return typeof id === "string" || typeof id === "number" ? id : null;
}

/**
 * Capture the request signals (§5.4 step 5).
 *
 * @param request - The HTTP request.
 * @param params - JSON-RPC params.
 * @param era - Era from the SDK classifier.
 * @param protocolVersion - Protocol version, when known.
 * @param mcpName - Decoded `Mcp-Name`.
 */
export function captureSignals(
  request: Request,
  params: Record<string, unknown>,
  era: SdkEra,
  protocolVersion: string | undefined,
  mcpName: { present: boolean; value?: string }
): EventsSignals {
  const meta = isRecord(params._meta) ? params._meta : {};
  const clientInfo = isRecord(meta["io.modelcontextprotocol/clientInfo"])
    ? (meta["io.modelcontextprotocol/clientInfo"] as {
        name?: string;
        version?: string;
      })
    : undefined;
  const caps = meta["io.modelcontextprotocol/clientCapabilities"];
  const extensions =
    isRecord(caps) && isRecord(caps.extensions) ? caps.extensions : undefined;
  const signals: EventsSignals = {
    era,
    declaresEventsExtension:
      extensions !== undefined && EVENTS_EXTENSION_ID in extensions,
    mcpName,
    mcpMethod: request.headers.has("mcp-method"),
  };
  if (protocolVersion !== undefined) signals.protocolVersion = protocolVersion;
  if (clientInfo !== undefined) {
    signals.clientInfo = {};
    if (typeof clientInfo.name === "string")
      signals.clientInfo.name = clientInfo.name;
    if (typeof clientInfo.version === "string")
      signals.clientInfo.version = clientInfo.version;
  }
  const ua = request.headers.get("user-agent");
  if (ua !== null) signals.userAgent = ua;
  const delivery = isRecord(params.delivery) ? params.delivery : undefined;
  const callback =
    typeof delivery?.url === "string"
      ? delivery.url
      : typeof params.url === "string"
        ? params.url
        : undefined;
  if (callback !== undefined) {
    try {
      signals.callbackHost = new URL(callback).host;
    } catch {
      // not a URL; the engine rejects it with InvalidParams
    }
  }
  return signals;
}

/**
 * Create the preflight `createMcpMount` calls for every POST body.
 *
 * @param options - Seams and settings.
 */
export function createEventsPreflight(
  options: PreflightOptions
): (request: Request, parsedBody: unknown) => Promise<Response | undefined> {
  const warned = new Set<string>();
  const recorded = new Set<string>();
  const mode = options.mcpName ?? "lenient";

  return async (request, body) => {
    if (request.method !== "POST") return undefined;

    // Batch rule (D75): any events/* member → HTTP 400, one −32600 per member.
    if (Array.isArray(body)) {
      const members = body.filter(isEventsMethod);
      if (members.length === 0) return undefined;
      const errors = members.map((m) => ({
        jsonrpc: "2.0",
        id: idOf(m),
        error: {
          code: INVALID_REQUEST_CODE,
          message: "Invalid Request",
          data: { reason: "events_in_batch" },
        },
      }));
      return new Response(JSON.stringify(errors), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    // Single requests only; notifications (no id) pass through.
    if (!isEventsMethod(body) || !isRecord(body) || !("id" in body)) {
      return undefined;
    }
    const method = body.method as string;
    const id = idOf(body);
    const params = isRecord(body.params) ? body.params : {};

    const inbound = options.sdk.inbound(request, body, {
      allowedHosts: options.allowedHosts,
      allowedOrigins: options.allowedOrigins,
    });
    if (!inbound.ok) {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id, error: inbound.error }),
        {
          status: inbound.status,
          headers: { "content-type": "application/json" },
        }
      );
    }
    const era = inbound.era;
    const mismatch = (header: string): Response => {
      const error: JsonRpcErrorObject = {
        code: HEADER_MISMATCH_CODE,
        message: `Bad Request: header ${header} does not match the request body`,
        data: { header },
      };
      return options.sdk.errorResponse(id, error, era);
    };

    // Mcp-Name (D9, §6.5).
    const rawName = request.headers.get(MCP_NAME_HEADER);
    const mcpName: { present: boolean; value?: string } = {
      present: rawName !== null,
    };
    if (rawName !== null) {
      const decoded = options.sdk.decodeHeaderValue(rawName);
      if (decoded !== undefined) mcpName.value = decoded;
    }
    const signals = captureSignals(
      request,
      params,
      era,
      inbound.protocolVersion,
      mcpName
    );
    const clientName = signals.clientInfo?.name ?? "(unknown)";
    if (!recorded.has(clientName)) {
      recorded.add(clientName);
      options.recordSignals?.(signals);
    }

    if (NAMED.has(method)) {
      if (rawName !== null) {
        if (mcpName.value === undefined || mcpName.value !== params.name) {
          return mismatch(MCP_NAME_HEADER);
        }
      } else if (era === "modern") {
        if (mode === "strict") return mismatch(MCP_NAME_HEADER);
        if (!warned.has(clientName)) {
          warned.add(clientName);
          options.warn?.(
            `events: client "${clientName}" sent ${method} without an Mcp-Name header (accepted, compatibility.mcpName is "lenient").`
          );
        }
      }

      const event =
        typeof params.name === "string"
          ? options.registry.get(params.name)
          : undefined;
      if (event !== undefined) {
        const args = isRecord(params.arguments) ? params.arguments : {};
        const check = checkParamHeaders(
          event.inputJsonSchema,
          args,
          request.headers
        );
        if (!check.ok) {
          const fatal =
            check.problem !== "missing" ||
            (mode === "strict" && era === "modern");
          if (fatal) return mismatch(check.header);
        }
      }
    }

    if (!METHODS.has(method)) {
      return options.sdk.errorResponse(
        id,
        { code: -32601, message: "Method not found" },
        era
      );
    }
    return options.dispatch({
      id,
      method: method as EventsResponderMethod,
      params,
      era,
      signals,
      request,
    });
  };
}

/**
 * CORS: the extra request headers to allow, echoing every requested
 * `mcp-param-*` header (D9).
 *
 * @param requested - `Access-Control-Request-Headers` value.
 */
export function corsParamHeaders(requested: string | null): string[] {
  if (requested === null) return [];
  return requested
    .split(",")
    .map((h) => h.trim())
    .filter((h) => /^mcp-param-/i.test(h));
}
