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
export const SCARF_GATEWAY_URL =
  "https://mcpuse.gateway.scarf.sh/events-ts";

/**
 * Send a single event to PostHog's public capture endpoint using `fetch` only
 * (no `posthog-js` / `posthog-node` SDK dependency). Errors are swallowed.
 *
 * ponytail: fire-and-forget single-event POST — no client-side batching. The
 * volume (init/connect events) is low enough that per-event requests are fine;
 * upgrade to `/batch/` if event volume grows.
 */
export function capturePostHog(params: {
  host?: string;
  apiKey?: string;
  event: string;
  distinctId: string;
  properties: Record<string, unknown>;
}): Promise<void> {
  const host = params.host ?? POSTHOG_HOST;
  const apiKey = params.apiKey ?? POSTHOG_API_KEY;
  return telFetch(`${host}/i/v0/e/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // `keepalive` lets in-flight telemetry survive a browser page unload.
    keepalive: true,
    body: JSON.stringify({
      api_key: apiKey,
      event: params.event,
      distinct_id: params.distinctId,
      properties: params.properties,
      timestamp: new Date().toISOString(),
    }),
  });
}

/** Send a single event to the Scarf gateway using `fetch` only. */
export function captureScarf(
  properties: Record<string, unknown>,
  endpoint: string = SCARF_GATEWAY_URL
): Promise<void> {
  return telFetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    body: JSON.stringify(properties),
  });
}
