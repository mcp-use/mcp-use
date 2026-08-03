/**
 * Fire-and-forget telemetry HTTP request. Never surfaces network/HTTP failures
 * to the host app — telemetry must not log or throw into user code.
 */
export async function telFetch(url: string, init?: RequestInit): Promise<void> {
  try {
    await fetch(url, init);
  } catch {
    // Telemetry must never break or log into the host app.
  }
}

export const POSTHOG_HOST = "https://eu.i.posthog.com";
export const POSTHOG_API_KEY =
  "phc_lyTtbYwvkdSbrcMQNPiKiiRWrrM1seyKIMjycSvItEI";

const CONTENT_PROPERTY =
  /(^|_)(arguments?|args|body|command|headers?|location|message|query|response|secret|subject|token|uri|url|user_agent)(_|$)/i;
const IDENTIFYING_PROPERTY =
  /(^|_)(server_identifiers?|server_names?|servers|tool_names?|tools_(available|used)_names)(_|$)/i;
const AGGREGATE_PROPERTY =
  /(_count|_length|_duration(?:_ms)?|_time_ms|(^|_)num_[a-z0-9_]+)$/i;

function normalizePropertyKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-z0-9_$]+/gi, "_")
    .toLowerCase();
}

function sanitizeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new TypeError("Cyclic telemetry properties are not supported");
    }
    seen.add(value);
    const sanitized = value.map((item) => sanitizeValue(item, seen));
    seen.delete(value);
    return sanitized;
  }

  if (
    value !== null &&
    typeof value === "object" &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  ) {
    if (seen.has(value)) {
      throw new TypeError("Cyclic telemetry properties are not supported");
    }
    seen.add(value);
    const sanitized = sanitizeProperties(
      value as Record<string, unknown>,
      seen
    );
    seen.delete(value);
    return sanitized;
  }

  return value;
}

function sanitizeProperties(
  properties: Record<string, unknown>,
  seen = new WeakSet<object>()
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    const normalizedKey = normalizePropertyKey(key);
    if (AGGREGATE_PROPERTY.test(normalizedKey)) {
      if (value === null || typeof value === "number") {
        sanitized[key] = value;
      }
      continue;
    }
    if (
      IDENTIFYING_PROPERTY.test(normalizedKey) ||
      CONTENT_PROPERTY.test(normalizedKey)
    ) {
      continue;
    }
    sanitized[key] = sanitizeValue(value, seen);
  }
  return sanitized;
}

/**
 * Send a single event to PostHog's public capture endpoint using `fetch` only
 * (no `posthog-js` / `posthog-node` SDK dependency). Errors are swallowed.
 */
export async function capturePostHog(params: {
  host?: string;
  apiKey?: string;
  event: string;
  distinctId: string;
  properties: Record<string, unknown>;
}): Promise<void> {
  try {
    const host = params.host ?? POSTHOG_HOST;
    const apiKey = params.apiKey ?? POSTHOG_API_KEY;
    const body = JSON.stringify({
      api_key: apiKey,
      event: params.event,
      distinct_id: params.distinctId,
      properties: sanitizeProperties(params.properties),
      timestamp: new Date().toISOString(),
    });
    await telFetch(`${host}/i/v0/e/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body,
    });
  } catch {
    // Invalid telemetry data must never surface into host application code.
  }
}
