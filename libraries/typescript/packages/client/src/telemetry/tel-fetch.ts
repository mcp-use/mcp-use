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

/**
 * Send a single event to PostHog's public capture endpoint using `fetch` only
 * (no `posthog-js` / `posthog-node` SDK dependency). Errors are swallowed.
 *
 * ponytail: fire-and-forget single-event POST — no client-side batching. The
 * volume (init/connect events) is low enough that per-event requests are fine;
 * upgrade to `/batch/` if event volume grows.
 */
export function capturePostHog(params: {
  host: string;
  apiKey: string;
  event: string;
  distinctId: string;
  properties: Record<string, unknown>;
}): Promise<void> {
  return telFetch(`${params.host}/i/v0/e/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // `keepalive` lets in-flight telemetry survive a browser page unload.
    keepalive: true,
    body: JSON.stringify({
      api_key: params.apiKey,
      event: params.event,
      distinct_id: params.distinctId,
      properties: params.properties,
      timestamp: new Date().toISOString(),
    }),
  });
}
