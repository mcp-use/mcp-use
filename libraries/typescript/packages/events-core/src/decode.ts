/**
 * Client-side decoding of Events errors in all three numberings (§6.13).
 *
 * @packageDocumentation
 */

import {
  DELIVERY_ERROR_CATEGORIES,
  type DeliveryErrorCategory,
} from "./wire.js";
import type { EventsErrorKind } from "./codes.js";

/** What {@link decodeEventsError} can return besides an {@link EventsErrorKind}. */
export type DecodedEventsError =
  | EventsErrorKind
  | "headerMismatch"
  | "notOffered"
  | "invalidRequest";

const SEP_RANGE: Readonly<Record<number, EventsErrorKind>> = {
  [-32023]: "notFound",
  [-32024]: "forbidden",
  [-32025]: "resourceExhausted",
  [-32026]: "unsupported",
  [-32027]: "callbackEndpointError",
};

const SKETCH_RANGE: Readonly<Record<number, EventsErrorKind>> = {
  [-32011]: "notFound",
  [-32012]: "forbidden",
  [-32013]: "resourceExhausted",
  [-32014]: "unsupported",
  [-32015]: "callbackEndpointError",
};

const KIND_NAME_IN_MESSAGE: Readonly<Record<EventsErrorKind, RegExp>> = {
  invalidParams: /invalid\s*params/i,
  notFound: /not\s*found/i,
  forbidden: /forbidden/i,
  resourceExhausted: /resource\s*exhausted/i,
  unsupported: /unsupported/i,
  callbackEndpointError: /callback\s*endpoint/i,
};

function dataRecord(data: unknown): Record<string, unknown> | undefined {
  return data !== null && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : undefined;
}

// Whether `message` or `data` agrees with `kind` (needed for the sketch range,
// which sits in the implementation-reserved −32000..−32019 band).
function agrees(
  kind: EventsErrorKind,
  message: string | undefined,
  data: Record<string, unknown> | undefined
): boolean {
  if (message !== undefined && KIND_NAME_IN_MESSAGE[kind].test(message)) {
    return true;
  }
  if (!data) return false;
  switch (kind) {
    case "notFound":
      return data.kind === "event" || data.kind === "subscription";
    case "forbidden":
      return typeof data.reason === "string";
    case "resourceExhausted":
      return typeof data.limit === "string";
    case "unsupported":
      return typeof data.feature === "string";
    case "callbackEndpointError":
      return DELIVERY_ERROR_CATEGORIES.includes(
        data.reason as DeliveryErrorCategory
      );
    default:
      return false;
  }
}

/**
 * Maps a JSON-RPC error from an Events server to its kind, whatever numbering
 * the server used:
 * - −32023…−32027 → the kind, always;
 * - −32011…−32015 → the kind only when `message` or `data` agrees (these codes are in the
 *   implementation-reserved range, so other servers use them for other things);
 * - −32602 with `data.kind` `event` or `subscription` → `notFound`; with `forbidden`,
 *   `resourceExhausted` or `unsupported` → that kind; otherwise → `invalidParams`;
 * - −32020 → `headerMismatch`; −32601 → `notOffered`;
 * - −32600 with `data.reason: "events_in_batch"` → `invalidRequest`.
 *
 * A client treats NotFound `{kind:"subscription"}` on unsubscribe as success.
 *
 * @param e - The error object of a JSON-RPC error response.
 * @returns The decoded kind, or `undefined` when the error is not an Events error.
 */
export function decodeEventsError(e: {
  code: number;
  message?: string;
  data?: unknown;
}): DecodedEventsError | undefined {
  const data = dataRecord(e.data);
  const sep = SEP_RANGE[e.code];
  if (sep) return sep;
  const sketch = SKETCH_RANGE[e.code];
  if (sketch) return agrees(sketch, e.message, data) ? sketch : undefined;
  switch (e.code) {
    case -32602: {
      const kind = data?.kind;
      if (kind === "event" || kind === "subscription") return "notFound";
      if (
        kind === "forbidden" ||
        kind === "resourceExhausted" ||
        kind === "unsupported"
      ) {
        return kind;
      }
      return "invalidParams";
    }
    case -32020:
      return "headerMismatch";
    case -32601:
      return "notOffered";
    case -32600:
      return data?.reason === "events_in_batch" ? "invalidRequest" : undefined;
    default:
      return undefined;
  }
}
