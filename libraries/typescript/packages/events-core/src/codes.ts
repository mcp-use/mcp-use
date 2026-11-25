/**
 * Events error kinds and their JSON-RPC codes in the three numberings of the
 * `errorCodes` axis (D53, §6.13). Numbers live only here; engines raise kinds.
 *
 * @packageDocumentation
 */

import type { ProfileAxes } from "./axes.js";

/** The Events error kinds of SEP-3415. */
export type EventsErrorKind =
  | "invalidParams"
  | "notFound"
  | "forbidden"
  | "resourceExhausted"
  | "unsupported"
  | "callbackEndpointError";

/** Every {@link EventsErrorKind}. */
export const EVENTS_ERROR_KINDS: readonly EventsErrorKind[] = [
  "invalidParams",
  "notFound",
  "forbidden",
  "resourceExhausted",
  "unsupported",
  "callbackEndpointError",
];

/** The three numberings of the `errorCodes` axis. */
export type ErrorNumbering = "sketch" | "sep" | "documented";

/**
 * JSON-RPC codes per kind and numbering:
 * - `sketch` (`openai@1`): −32011…−32015, from the ChatGPT design sketch;
 * - `sep` (`sep-3415@1`): −32023…−32027, equal to the SDK's `EVENTS_ERROR_CODES` (PR #3209);
 * - `documented` (a row override): −32602 with `data.kind` for NotFound, Forbidden,
 *   ResourceExhausted and Unsupported, −32015 for CallbackEndpointError.
 */
export const EVENTS_ERROR_CODES: {
  readonly [N in ErrorNumbering]: Readonly<Record<EventsErrorKind, number>>;
} = {
  sketch: {
    invalidParams: -32602,
    notFound: -32011,
    forbidden: -32012,
    resourceExhausted: -32013,
    unsupported: -32014,
    callbackEndpointError: -32015,
  },
  sep: {
    invalidParams: -32602,
    notFound: -32023,
    forbidden: -32024,
    resourceExhausted: -32025,
    unsupported: -32026,
    callbackEndpointError: -32027,
  },
  documented: {
    invalidParams: -32602,
    notFound: -32602,
    forbidden: -32602,
    resourceExhausted: -32602,
    unsupported: -32602,
    callbackEndpointError: -32015,
  },
};

/** `Mcp-Name` or `Mcp-Param-*` disagrees with the body (HTTP 400), in every numbering. */
export const HEADER_MISMATCH_CODE = -32020;

/** Events are not offered (not advertised, or the method is unknown), in every numbering. */
export const NOT_OFFERED_CODE = -32601;

/** A JSON-RPC batch that contains an `events/*` member (HTTP 400, `data.reason: "events_in_batch"`). */
export const INVALID_REQUEST_CODE = -32600;

/** Internal or degraded (`data.reason`: `storage_unavailable`, `sdk_capability_conflict`, `layout_unsupported`). */
export const INTERNAL_ERROR_CODE = -32603;

/** A JSON-RPC error object. */
export interface JsonRpcErrorObject {
  /** The JSON-RPC error code. */
  code: number;
  /** A short description. */
  message: string;
  /** Typed details. */
  data?: unknown;
}

const DEFAULT_MESSAGES: Readonly<Record<EventsErrorKind, string>> = {
  invalidParams: "Invalid params",
  notFound: "Not found",
  forbidden: "Forbidden",
  resourceExhausted: "Resource exhausted",
  unsupported: "Unsupported",
  callbackEndpointError: "Callback endpoint error",
};

/** The `data.kind` the `documented` numbering puts on each kind it maps to −32602. */
const DOCUMENTED_KIND: Partial<Record<EventsErrorKind, string>> = {
  forbidden: "forbidden",
  resourceExhausted: "resourceExhausted",
  unsupported: "unsupported",
};

/**
 * An Events error raised by a server (engine, hooks) and serialized per the
 * caller's profile. Throw it from `onSubscribe` or `authorize` to answer with
 * a typed error.
 */
export class EventsError extends Error {
  /** The error kind; the JSON-RPC code depends on the profile's `errorCodes` axis. */
  readonly kind: EventsErrorKind;
  /** Typed details (`kind`, `reason`, `limit`, `feature`, `field`, …). */
  readonly data?: Record<string, unknown>;

  /**
   * @param kind - The error kind.
   * @param message - A short description; an empty string uses the kind's default message.
   * @param data - Typed details, for example `{ kind: "event" }` for NotFound.
   */
  constructor(
    kind: EventsErrorKind,
    message: string,
    data?: Record<string, unknown>
  ) {
    super(message === "" ? DEFAULT_MESSAGES[kind] : message);
    this.name = "EventsError";
    this.kind = kind;
    if (data !== undefined) this.data = data;
  }

  /**
   * Serializes the error as a JSON-RPC error object in the profile's
   * numbering. Under `documented`, NotFound keeps its `data.kind` (`event` or
   * `subscription`) and Forbidden, ResourceExhausted and Unsupported get
   * `data.kind` set to their kind name. An `errorCodes` value this build does
   * not know uses the `sep` numbering.
   *
   * @param axes - The caller's profile axes (only `errorCodes` is read).
   * @returns `{ code, message, data? }`.
   */
  toJsonRpc(axes: Pick<ProfileAxes, "errorCodes">): JsonRpcErrorObject {
    const numbering: ErrorNumbering =
      axes.errorCodes === "sketch"
        ? "sketch"
        : axes.errorCodes === "documented"
          ? "documented"
          : "sep";
    const code = EVENTS_ERROR_CODES[numbering][this.kind];
    let data: Record<string, unknown> | undefined = this.data;
    const documentedKind = DOCUMENTED_KIND[this.kind];
    if (numbering === "documented" && documentedKind !== undefined) {
      data = { ...this.data, kind: documentedKind };
    }
    const out: JsonRpcErrorObject = { code, message: this.message };
    if (data !== undefined) out.data = data;
    return out;
  }
}
