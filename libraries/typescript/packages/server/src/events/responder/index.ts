/**
 * Responder dispatch of the five `events/*` methods (D75). The preflight
 * hands every single JSON-RPC `events/*` request here after the inbound
 * ladder and header checks. `events/list` is answered from the registry;
 * subscribe, unsubscribe, poll and stream are delegated to the engine
 * through {@link ResponderEngine}.
 *
 * @internal
 */

import {
  EVENTS_ERROR_CODES,
  EventsError,
  INTERNAL_ERROR_CODE,
  NOT_OFFERED_CODE,
  DIALECT_RESPONSE_HEADER,
} from "@mcp-use/events-core";
import type {
  EventDescriptor,
  EventsSignals,
  JsonRpcErrorObject,
} from "@mcp-use/events-core";
import { canonicalJson } from "@mcp-use/events-core";

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): string | undefined {
  try {
    const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    return new TextDecoder().decode(
      Uint8Array.from(bin, (c) => c.charCodeAt(0))
    );
  } catch {
    return undefined;
  }
}
import type { EventsRegistry, RegisteredEvent } from "../internal/registry.js";
import type { SdkEra, SdkEventsAdapter } from "../sdk-adapter.js";
import type { DeliveryMode } from "../types.js";

/** The five methods the responder owns. */
export type EventsResponderMethod =
  | "events/list"
  | "events/subscribe"
  | "events/unsubscribe"
  | "events/poll"
  | "events/stream";

/** One dispatched request as the engine sees it. */
export interface ResponderRequest {
  /** JSON-RPC id. */
  id: string | number | null;
  /** Method. */
  method: EventsResponderMethod;
  /** Unredacted params (the engine is the only reader of `delivery.secret`). */
  params: Record<string, unknown>;
  /** Era from the SDK classifier. */
  era: SdkEra;
  /** Signals captured by the preflight. */
  signals: EventsSignals;
  /** The original HTTP request (auth, abort signal, request bag). */
  request: Request;
}

/** What the engine returns for a JSON method, or a stream response. */
export type ResponderOutcome =
  | {
      /** JSON result. */
      result: Record<string, unknown>;
      /** Resolved dialect, echoed in `x-mcp-use-events-dialect`. */
      dialect?: string;
    }
  | {
      /** A `text/event-stream` response (events/stream only). */
      response: Response;
    };

/** The engine seam (subscribe, unsubscribe, poll, stream). Filled by WP-24/WP-20. */
export interface ResponderEngine {
  /** Handle one request; throw `EventsError` for typed failures. */
  handle(request: ResponderRequest): Promise<ResponderOutcome>;
}

/** Wraps the handler in the `mcp:events/*` middleware chain (WP-22). */
export type ResponderMiddleware = (
  request: ResponderRequest,
  next: () => Promise<ResponderOutcome>
) => Promise<ResponderOutcome>;

/** Server facts the responder reads. */
export interface ResponderOptions {
  /** The catalog. */
  registry: EventsRegistry;
  /** The SDK seam. */
  sdk: SdkEventsAdapter;
  /** The engine, when bound; absent answers −32603 `storage_unavailable`. */
  engine?: () => Promise<ResponderEngine | undefined>;
  /** Effective modes per event (§7.1.2) for the sep profile. */
  modesFor(event: RegisteredEvent): DeliveryMode[];
  /** Whether webhook is available for the openai profile. */
  openaiWebhook(event: RegisteredEvent): boolean;
  /** `visible(ctx)` evaluation; default: every event visible. */
  visible?(event: RegisteredEvent, request: ResponderRequest): Promise<boolean>;
  /** Middleware chain. */
  middleware?: ResponderMiddleware | undefined;
  /** SDK probe P1 failed: Events is off. */
  off?: boolean;
  /** Track a stream response for mount shutdown. */
  trackStream?(response: Response): Response;
}

const PAGE_SIZE = 100;

function errorFor(
  error: unknown,
  numbering: "sketch" | "sep"
): JsonRpcErrorObject {
  if (error instanceof EventsError) {
    return error.toJsonRpc({ errorCodes: numbering });
  }
  return { code: INTERNAL_ERROR_CODE, message: "Internal error" };
}

/** `nextCursor` is opaque base64url `{offset, catalogHash}` (§6.6). */
function encodeCursor(offset: number, hash: string): string {
  return toBase64Url(canonicalJson({ h: hash, o: offset }));
}

function decodeCursor(cursor: unknown, hash: string): number {
  if (typeof cursor !== "string") return 0;
  const text = fromBase64Url(cursor);
  if (text === undefined) return 0;
  try {
    const parsed = JSON.parse(text) as {
      h?: string;
      o?: number;
    };
    return parsed.h === hash && Number.isInteger(parsed.o) && parsed.o! >= 0
      ? parsed.o!
      : 0;
  } catch {
    return 0;
  }
}

/**
 * Build the `events/list` result for one caller.
 *
 * @param options - Responder options.
 * @param request - The dispatched request.
 * @param profile - `"openai"` lists webhook-only; `"sep-3415"` lists servable modes.
 */
export async function listEvents(
  options: ResponderOptions,
  request: ResponderRequest,
  profile: "openai" | "sep-3415"
): Promise<Record<string, unknown>> {
  const hash = options.registry.catalogHash;
  const descriptors: EventDescriptor[] = [];
  for (const event of options.registry.all()) {
    if (options.visible && !(await options.visible(event, request))) continue;
    let delivery: DeliveryMode[];
    if (profile === "openai") {
      delivery = options.openaiWebhook(event) ? ["webhook"] : [];
    } else {
      delivery = options.modesFor(event);
    }
    if (delivery.length === 0) continue;
    const descriptor: EventDescriptor = {
      name: event.name,
      description: event.definition.description,
      delivery,
      inputSchema: event.inputJsonSchema,
      payloadSchema: event.payloadJsonSchema,
    };
    if (event.definition._meta !== undefined) {
      descriptor._meta = event.definition._meta;
    }
    descriptors.push(descriptor);
  }
  const offset = decodeCursor(request.params.cursor, hash);
  const page = descriptors.slice(offset, offset + PAGE_SIZE);
  const result: Record<string, unknown> = { events: page };
  if (offset + PAGE_SIZE < descriptors.length) {
    result.nextCursor = encodeCursor(offset + PAGE_SIZE, hash);
  }
  return result;
}

/**
 * Answer one `events/*` request (§5.4 responder steps).
 *
 * @param options - Responder options.
 * @param request - The dispatched request.
 */
export async function respond(
  options: ResponderOptions,
  request: ResponderRequest
): Promise<Response> {
  const { sdk, registry } = options;
  const profile: "openai" | "sep-3415" =
    request.method === "events/poll" ||
    request.method === "events/stream" ||
    request.era === "modern"
      ? "sep-3415"
      : "openai";
  const numbering = profile === "openai" ? "sketch" : "sep";
  const fail = (error: JsonRpcErrorObject) =>
    sdk.errorResponse(request.id, error, request.era);

  if (registry.size === 0) {
    return fail({ code: NOT_OFFERED_CODE, message: "Method not found" });
  }
  if (options.off === true) {
    return fail({
      code: INTERNAL_ERROR_CODE,
      message: "Internal error",
      data: { reason: "sdk_capability_conflict" },
    });
  }
  if (
    request.era === "legacy" &&
    (request.method === "events/poll" || request.method === "events/stream")
  ) {
    return fail({ code: NOT_OFFERED_CODE, message: "Method not found" });
  }

  const handler = async (): Promise<ResponderOutcome> => {
    if (request.method === "events/list") {
      return {
        result: await listEvents(options, request, profile),
        dialect: profile,
      };
    }
    const engine = await options.engine?.();
    if (engine === undefined) {
      throw new EventsUnavailable();
    }
    return engine.handle(request);
  };

  let outcome: ResponderOutcome;
  try {
    outcome =
      options.middleware !== undefined
        ? await options.middleware(request, handler)
        : await handler();
  } catch (error) {
    if (error instanceof EventsUnavailable) {
      return fail({
        code: INTERNAL_ERROR_CODE,
        message: "Internal error",
        data: { reason: "storage_unavailable" },
      });
    }
    return fail(errorFor(error, numbering));
  }
  if ("response" in outcome) {
    return options.trackStream
      ? options.trackStream(outcome.response)
      : outcome.response;
  }
  const headers = new Headers({ "content-type": "application/json" });
  headers.set(DIALECT_RESPONSE_HEADER, outcome.dialect ?? profile);
  return new Response(
    JSON.stringify(sdk.envelope(request.id, outcome.result, request.era)),
    { status: 200, headers }
  );
}

/** Thrown internally when no engine is bound. */
class EventsUnavailable extends Error {}

/** The NotFound code per numbering, for tests. */
export const NOT_FOUND_CODES = {
  sketch: EVENTS_ERROR_CODES.sketch.notFound,
  sep: EVENTS_ERROR_CODES.sep.notFound,
} as const;
