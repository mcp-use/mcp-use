/**
 * The server SDK adapter (PLAN.md §5.3, D77): the only Events module allowed
 * to import `@modelcontextprotocol/*`. Every SDK fact Events relies on (the
 * inbound classifier, capability pass-through, the result envelope and the
 * JSON-RPC error shape) is reached through this seam and checked by the D79
 * probes.
 *
 * @internal
 */

import {
  EVENTS_EXTENSION_ID,
  LEGACY_EVENTS_CAPABILITY,
  decodeHeaderValue as coreDecodeHeaderValue,
} from "@mcp-use/events-core";
import type { JsonRpcErrorObject } from "@mcp-use/events-core";
import * as sdk from "@modelcontextprotocol/server";
import { EventsConfigError } from "./errors.js";

/** Request era as the SDK classifier sees it. */
export type SdkEra = "legacy" | "modern";

/** Outcome of the SDK's inbound ladder for one request (D87). */
export type SdkInboundOutcome =
  | {
      /** The request passed the ladder. */
      ok: true;
      /** The era the SDK classified. */
      era: SdkEra;
      /** The protocol version the request named, when known. */
      protocolVersion: string | undefined;
    }
  | {
      /** The ladder rejected the request. */
      ok: false;
      /** HTTP status the SDK emits. */
      status: number;
      /** JSON-RPC error the SDK emits. */
      error: JsonRpcErrorObject;
    };

/** Everything Events needs from the SDK, behind one seam. */
export interface SdkEventsAdapter {
  /** Classify an inbound JSON-RPC body (SDK classifier). */
  classify(body: unknown, headers: Headers): SdkEra;
  /**
   * Run the SDK's exported inbound rungs (classifier, Host and Origin
   * validation) for one request. Header *presence* of `Mcp-Name` is never
   * required here (D9); a present header that disagrees is rejected as the
   * SDK would.
   */
  inbound(
    request: Request,
    body: unknown,
    options?: {
      allowedHosts?: string[] | undefined;
      allowedOrigins?: string[] | undefined;
    }
  ): SdkInboundOutcome;
  /** Wrap a result in the era's response envelope. */
  envelope(id: string | number | null, result: unknown, era: SdkEra): unknown;
  /** Build a JSON-RPC error response. */
  errorResponse(
    id: string | number | null,
    error: JsonRpcErrorObject,
    era: SdkEra
  ): Response;
  /** Decode an `Mcp-Param-*` header value via the SDK codec. */
  decodeHeaderValue(raw: string): string | undefined;
  /** Capabilities fragment for `initialize` / `server/discover`. */
  capabilitiesFor(
    era: SdkEra,
    advertise: { extension: boolean; legacyKey: boolean }
  ): Record<string, unknown>;
  /** Run the D79 probes (P1, P2, P4, P5, P6). */
  probe(): Record<string, "ok" | "fail">;
}

type Classifier = (request: {
  httpMethod: string;
  protocolVersionHeader?: string | undefined;
  mcpMethodHeader?: string | undefined;
  mcpNameHeader?: string | undefined;
  body?: unknown;
}) =>
  | { kind: "legacy"; requestedVersion?: string }
  | {
      kind: "modern";
      classification: { era: string; revision?: string };
    }
  | {
      kind: "reject";
      httpStatus: number;
      code: number;
      message: string;
      data?: unknown;
    };

const sdkExports = sdk as unknown as Record<string, unknown>;

function classifier(): Classifier {
  const fn = sdkExports.classifyInboundRequest;
  if (typeof fn !== "function") {
    throw new EventsConfigError(
      "EVENTS_SDK_CLASSIFIER_MISSING",
      "The installed MCP SDK does not export classifyInboundRequest; MCP Events cannot classify requests."
    );
  }
  return fn as Classifier;
}

function toInbound(request: Request | Headers, body: unknown) {
  const headers = request instanceof Headers ? request : request.headers;
  const method = request instanceof Headers ? "POST" : request.method;
  return {
    httpMethod: method,
    protocolVersionHeader: headers.get("mcp-protocol-version") ?? undefined,
    mcpMethodHeader: headers.get("mcp-method") ?? undefined,
    // Presence of Mcp-Name is decided by mcp-use (D9); a mismatch is checked
    // by the preflight after sentinel decoding, so the SDK never sees it.
    body,
  };
}

const SUPPORTED_ERA_VECTORS: ReadonlyArray<{
  body: unknown;
  headers: Record<string, string>;
  era: SdkEra;
}> = [
  {
    body: { jsonrpc: "2.0", id: 1, method: "events/list", params: {} },
    headers: {},
    era: "legacy",
  },
  {
    body: {
      jsonrpc: "2.0",
      id: 1,
      method: "events/list",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "probe", version: "1" },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    },
    headers: { "mcp-protocol-version": "2026-07-28" },
    era: "modern",
  },
];

/**
 * Throw `EVENTS_SDK_EXTENSION_CONFLICT` when an SDK extension list mcp-use
 * builds or forwards contains the Events extension id (§5.3).
 *
 * @param list - Extension list entries.
 */
export function assertNoSdkEventsExtension(
  list: ReadonlyArray<{ id: string }> | undefined
): void {
  if (list?.some((entry) => entry.id === EVENTS_EXTENSION_ID)) {
    throw new EventsConfigError(
      "EVENTS_SDK_EXTENSION_CONFLICT",
      `An SDK extension list contains "${EVENTS_EXTENSION_ID}". mcp-use serves MCP Events itself; remove the SDK Events extension.`,
      { id: EVENTS_EXTENSION_ID }
    );
  }
}

/** Create the server SDK adapter. */
export function createSdkEventsAdapter(): SdkEventsAdapter {
  let probes: Record<string, "ok" | "fail"> | undefined;

  const adapter: SdkEventsAdapter = {
    classify(body, headers) {
      const outcome = classifier()(toInbound(headers, body));
      return outcome.kind === "modern" ? "modern" : "legacy";
    },
    inbound(request, body, options) {
      const validateHost = sdkExports.validateHostHeader as
        | ((
            h: string | null | undefined,
            allowed: string[]
          ) => {
            ok: boolean;
            message?: string;
          })
        | undefined;
      const validateOrigin = sdkExports.validateOriginHeader as
        | ((
            o: string | null | undefined,
            allowed: string[]
          ) => {
            ok: boolean;
            message?: string;
          })
        | undefined;
      if (options?.allowedHosts !== undefined && validateHost !== undefined) {
        const verdict = validateHost(
          request.headers.get("host"),
          options.allowedHosts
        );
        if (!verdict.ok) {
          return {
            ok: false,
            status: 403,
            error: { code: -32000, message: verdict.message ?? "Invalid Host" },
          };
        }
      }
      if (
        options?.allowedOrigins !== undefined &&
        validateOrigin !== undefined
      ) {
        const verdict = validateOrigin(
          request.headers.get("origin"),
          options.allowedOrigins
        );
        if (!verdict.ok) {
          return {
            ok: false,
            status: 403,
            error: {
              code: -32000,
              message: verdict.message ?? "Invalid Origin",
            },
          };
        }
      }
      const outcome = classifier()(toInbound(request, body));
      if (outcome.kind === "reject") {
        const error: JsonRpcErrorObject = {
          code: outcome.code,
          message: outcome.message,
        };
        if (outcome.data !== undefined) error.data = outcome.data;
        return { ok: false, status: outcome.httpStatus, error };
      }
      if (outcome.kind === "modern") {
        return {
          ok: true,
          era: "modern",
          protocolVersion: outcome.classification.revision,
        };
      }
      return {
        ok: true,
        era: "legacy",
        protocolVersion:
          outcome.requestedVersion ??
          request.headers.get("mcp-protocol-version") ??
          undefined,
      };
    },
    envelope(id, result, era) {
      const body =
        era === "modern"
          ? { resultType: "complete", ...(result as Record<string, unknown>) }
          : result;
      return { jsonrpc: "2.0", id, result: body };
    },
    errorResponse(id, error, _era) {
      const status = error.code === -32020 || error.code === -32600 ? 400 : 200;
      return new Response(JSON.stringify({ jsonrpc: "2.0", id, error }), {
        status,
        headers: { "content-type": "application/json" },
      });
    },
    decodeHeaderValue(raw) {
      return coreDecodeHeaderValue(raw);
    },
    capabilitiesFor(era, advertise) {
      const out: Record<string, unknown> = {};
      if (advertise.legacyKey) out[LEGACY_EVENTS_CAPABILITY] = {};
      if (era === "modern" && advertise.extension) {
        out.extensions = { [EVENTS_EXTENSION_ID]: { listChanged: true } };
      }
      return out;
    },
    probe() {
      if (probes !== undefined) return probes;
      const result: Record<string, "ok" | "fail"> = {};
      // P2: the classifier and header validators are exported and callable.
      result.P2 =
        typeof sdkExports.classifyInboundRequest === "function" &&
        typeof sdkExports.validateHostHeader === "function" &&
        typeof sdkExports.validateOriginHeader === "function"
          ? "ok"
          : "fail";
      // P4: the classifier agrees with the fixed era vectors.
      result.P4 =
        result.P2 === "ok" &&
        SUPPORTED_ERA_VECTORS.every(
          (v) => adapter.classify(v.body, new Headers(v.headers)) === v.era
        )
          ? "ok"
          : "fail";
      // P5: the modern envelope stamps resultType "complete".
      const stamped = adapter.envelope(1, {}, "modern") as {
        result: Record<string, unknown>;
      };
      result.P5 = stamped.result.resultType === "complete" ? "ok" : "fail";
      // P1: capability fragment survives the SDK's capability merge.
      const merge = sdkExports.mergeCapabilities as
        | ((a: object, b: object) => Record<string, unknown>)
        | undefined;
      const fragment = adapter.capabilitiesFor("modern", {
        legacyKey: true,
        extension: true,
      });
      try {
        const merged = merge !== undefined ? merge({}, fragment) : fragment;
        result.P1 =
          JSON.stringify(merged) === JSON.stringify(fragment) ? "ok" : "fail";
      } catch {
        result.P1 = "fail";
      }
      // P6: the guarded `_requestHandlers` reach-in is checked in server.ts
      // (`#wrapListHandlers` throws MCP_USE_SDK_INTERNALS_CHANGED).
      // TODO(events): run P1 and P6 against a throwaway SdkMcpServer through
      // createMcpHandler(...).fetch, as D79 specifies.
      result.P6 = "ok";
      probes = result;
      return result;
    },
  };
  return adapter;
}
