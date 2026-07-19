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

/**
 * Send a single event to PostHog's public capture endpoint using `fetch` only
 * (no `posthog-js` / `posthog-node` SDK dependency). Errors are swallowed.
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
