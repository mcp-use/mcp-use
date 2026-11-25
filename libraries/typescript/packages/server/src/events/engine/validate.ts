/**
 * Request validation (PLAN.md WP-11): subscription arguments against the
 * event's `inputSchema`, `Mcp-Param-*` headers against `x-mcp-header`
 * annotations, and the `Mcp-Name` check (D9).
 *
 * @internal
 */

import {
  checkParamHeaders,
  EventsError,
  HEADER_MISMATCH_CODE,
  normalizeArguments,
  type EventsSignals,
} from "@mcp-use/events-core";
import type { EventSchema } from "../types.js";

interface StandardResult {
  value?: unknown;
  issues?: ReadonlyArray<{
    message: string;
    path?: ReadonlyArray<PropertyKey | { key: PropertyKey }>;
  }>;
}

/**
 * Validates arguments with the event's Standard Schema.
 *
 * @param schema - `inputSchema`, or `undefined` for an event without arguments.
 * @param raw - `params.arguments` as received.
 * @returns The schema output (normalized args).
 * @throws {@link EventsError} `invalidParams` with `{field:"arguments", issues}`.
 */
export async function validateArguments(
  schema: EventSchema | undefined,
  raw: unknown
): Promise<Record<string, unknown>> {
  const args = normalizeArguments(raw);
  if (typeof args !== "object" || Array.isArray(args)) {
    throw new EventsError("invalidParams", "arguments must be an object", {
      field: "arguments",
    });
  }
  if (!schema) {
    if (Object.keys(args).length > 0) {
      throw new EventsError("invalidParams", "This event takes no arguments", {
        field: "arguments",
      });
    }
    return {};
  }
  const r = (await schema["~standard"].validate(args)) as StandardResult;
  if (r.issues && r.issues.length > 0) {
    throw new EventsError("invalidParams", "Invalid subscription arguments", {
      field: "arguments",
      issues: r.issues.map((i) => ({
        message: i.message,
        path: (i.path ?? []).map((p) =>
          typeof p === "object" && p !== null ? String(p.key) : String(p)
        ),
      })),
    });
  }
  return (r.value ?? args) as Record<string, unknown>;
}

/** Thrown for an `Mcp-Param-*` disagreement; serialized with code −32020. */
export class HeaderMismatchError extends Error {
  /** JSON-RPC code. */
  readonly code = HEADER_MISMATCH_CODE;
  /**
   * @param header - The header that disagrees.
   * @param problem - What is wrong with it.
   */
  constructor(
    readonly header: string,
    readonly problem: "missing" | "mismatch" | "invalid_encoding"
  ) {
    super(`Header ${header} ${problem}`);
    this.name = "HeaderMismatchError";
  }
}

/**
 * Checks `Mcp-Param-*` headers and the `Mcp-Name` header.
 *
 * @param o - Schema, args, headers, signals, event name and policy.
 * @throws {@link HeaderMismatchError} on a param disagreement (a `missing` header only under `strict`), or a wrong or (strict) missing `Mcp-Name`.
 */
export function checkRequestHeaders(o: {
  inputJsonSchema: Record<string, unknown>;
  args: Record<string, unknown>;
  headers: Headers;
  signals: EventsSignals;
  name: string;
  /** Whether this request must carry `Mcp-Name` (sep-3415 subscribe/unsubscribe). */
  expectsMcpName: boolean;
  policy: "lenient" | "strict";
}): void {
  const n = o.signals.mcpName;
  if (o.expectsMcpName) {
    if (n.present && n.value === undefined)
      throw new HeaderMismatchError("Mcp-Name", "invalid_encoding");
    if (n.present && n.value !== o.name)
      throw new HeaderMismatchError("Mcp-Name", "mismatch");
    if (!n.present && o.policy === "strict")
      throw new HeaderMismatchError("Mcp-Name", "missing");
  }
  const r = checkParamHeaders(o.inputJsonSchema, o.args, o.headers);
  if (!r.ok && (r.problem !== "missing" || o.policy === "strict")) {
    throw new HeaderMismatchError(r.header, r.problem);
  }
}
