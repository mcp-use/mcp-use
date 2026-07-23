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
  /(^|_)(server_identifiers?|tool_names?|tools_(available|used)_names)(_|$)/i;
const AGGREGATE_PROPERTY = /(_count|_length|_duration(?:_ms)?|_time_ms)$/i;

function sanitizeProperties(
  properties: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(properties).filter(
      ([key, value]) =>
        (AGGREGATE_PROPERTY.test(key)
          ? value === null || typeof value === "number"
          : !CONTENT_PROPERTY.test(key)) && !IDENTIFYING_PROPERTY.test(key)
    )
  );
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
