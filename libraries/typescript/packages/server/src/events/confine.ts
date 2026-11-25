/**
 * Secret confinement (D42): every object user code, middleware, observers,
 * logs or telemetry see carries `"whsec_[redacted]"` in place of
 * `params.delivery.secret`. Only the engine sees the value.
 *
 * @internal
 */

/** The placeholder that replaces a webhook secret outside the engine. */
export const REDACTED_SECRET = "whsec_[redacted]";

/**
 * Return a deep copy of `params` with `delivery.secret` redacted. The input
 * is never mutated; non-object input is returned unchanged.
 *
 * @param params - JSON-RPC params of an `events/*` request.
 */
export function redactEventsParams<T>(params: T): T {
  if (params === null || typeof params !== "object") return params;
  const copy = structuredClone(params) as Record<string, unknown>;
  const delivery = copy.delivery;
  if (delivery !== null && typeof delivery === "object") {
    const d = delivery as Record<string, unknown>;
    if (d.secret !== undefined) d.secret = REDACTED_SECRET;
  }
  return copy as T;
}

/**
 * Redact a whole JSON-RPC message or batch for logging.
 *
 * @param message - A parsed JSON-RPC message or batch.
 */
export function redactEventsMessage<T>(message: T): T {
  if (Array.isArray(message)) {
    return (message as unknown[]).map((m: unknown) =>
      redactEventsMessage(m)
    ) as T;
  }
  if (message === null || typeof message !== "object") return message;
  const m = message as Record<string, unknown>;
  if (typeof m.method !== "string" || !m.method.startsWith("events/")) {
    return message;
  }
  return { ...m, params: redactEventsParams(m.params) } as T;
}

/**
 * Replace any `whsec_…` secret value in free text (log line, error message).
 *
 * @param text - Free text.
 */
export function scrubSecrets(text: string): string {
  return text.replace(
    /whsec_(?!\[redacted\])[A-Za-z0-9+/=_-]+/g,
    REDACTED_SECRET
  );
}
