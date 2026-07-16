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
export const SCARF_GATEWAY_URL = "https://mcpuse.gateway.scarf.sh/events-ts";
export const SCARF_GATEWAY_BEACON_URL =
  "https://mcpuse.gateway.scarf.sh/simple/";

const SCARF_BEACON_MAX_URL = 1800;
const SCARF_BEACON_TRUNCATED_KEYS = new Set(["query", "response", "messages"]);

function stringifyScarfValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Build a GET beacon URL for browser Scarf telemetry (query params, length-capped). */
export function buildScarfBeaconUrl(
  properties: Record<string, unknown>,
  baseUrl: string = SCARF_GATEWAY_BEACON_URL
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(properties)) {
    let serialized = stringifyScarfValue(value);
    if (SCARF_BEACON_TRUNCATED_KEYS.has(key) && serialized.length > 120) {
      serialized = `${serialized.slice(0, 117)}...`;
    }
    if (serialized !== "") params.set(key, serialized);
  }

  let url = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${params.toString()}`;
  if (url.length <= SCARF_BEACON_MAX_URL) return url;

  // ponytail: drop largest optional fields until the URL fits; upgrade to proxy if needed.
  const keys = [...params.keys()].sort(
    (a, b) => (params.get(b)?.length ?? 0) - (params.get(a)?.length ?? 0)
  );
  for (const key of keys) {
    if (url.length <= SCARF_BEACON_MAX_URL) break;
    if (key === "event" || key === "user_id") continue;
    params.delete(key);
    url = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${params.toString()}`;
  }
  return url.slice(0, SCARF_BEACON_MAX_URL);
}

function captureScarfPost(
  properties: Record<string, unknown>,
  endpoint: string
): Promise<void> {
  return telFetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    body: JSON.stringify(properties),
  });
}

function captureScarfBeacon(
  properties: Record<string, unknown>,
  endpoint: string
): Promise<void> {
  try {
    const url = buildScarfBeaconUrl(properties, endpoint);
    const img = new Image();
    img.referrerPolicy = "no-referrer-when-downgrade";
    img.src = url;
  } catch {
    // Telemetry must never break or log into the host app.
  }
  return Promise.resolve();
}

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

/** Send a single event to Scarf. Browser uses GET image beacon; Node uses POST JSON. */
export function captureScarf(
  properties: Record<string, unknown>,
  endpoint: string = SCARF_GATEWAY_URL
): Promise<void> {
  if (typeof window !== "undefined") {
    const beaconEndpoint =
      endpoint === SCARF_GATEWAY_URL ? SCARF_GATEWAY_BEACON_URL : endpoint;
    return captureScarfBeacon(properties, beaconEndpoint);
  }
  return captureScarfPost(properties, endpoint);
}
