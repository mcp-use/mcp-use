/**
 * A client for Lane's managed Order API, and nothing else.
 *
 * THIS SERVER DOES NOT CHECK ANYONE OUT. `POST /agent/v1/orders` on `apps/mcp`
 * does: it builds a LaneIntent, approves it headlessly, drives the browser,
 * fills the Lane card and confirms to VGS. This file is the HTTP client for that
 * API, so the checkout engine has exactly one implementation and it is not here.
 *
 * THE ERROR CODE IS THE PAYLOAD. The API answers `order_api_forbidden` (not a
 * Business plan), `merchant_required`, `product_required`, `gift_note_too_long`,
 * `idempotency_conflict` and a per-field list on a 400. Every one of those is
 * actionable and an HTTP status is not, so the code and description are carried
 * into the thrown message verbatim.
 */

export type ShipTo = {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postal_code: string;
  /** ISO 3166-1 alpha-2. The API enforces the length. */
  country: string;
  /** REQUIRED by the API: a merchant add-address form will not submit without
   *  one, so an order lacking it loops instead of failing. */
  phone: string;
};

/** What the catalog knew at the click. Carrying it is what lets Lane's
 *  pre-place-order check assert the cart holds the APPROVED SKU at the approved
 *  price; without it only the budget bounds the order. */
export type UcpLine = {
  variant_id: string;
  title: string;
  unit_price: string;
  currency: string;
};

export type CreateOrderBody = {
  product_url: string;
  product?: string;
  max_price: string;
  currency: string;
  merchant: string;
  quantity: number;
  ship_to: ShipTo;
  ucp_line?: UcpLine;
  metadata?: Record<string, string>;
  dry_run?: boolean;
};

export type OrderCreated = {
  order_id: string;
  status: string;
  created_at: string;
};

export type OrderStatus = {
  order_id: string;
  status: string;
  merchant?: string | null;
  amount_charged?: string | null;
  order_number?: string | null;
  tracking?: unknown;
  confirmation_screenshot_url?: string | null;
  reason?: string | null;
  failure_reason?: string | null;
  failure_category?: string | null;
  failure_stage?: string | null;
  ask_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type LaneApiDeps = { fetchImpl?: typeof fetch };

export class LaneApiError extends Error {}

/** A checkout run is a browser session on somebody else's storefront. The API
 *  answers 202 immediately and the run continues in the background, so this
 *  timeout covers the ACCEPT, never the checkout. `getOrder` may long-poll for
 *  up to 60s, so it adds its own wait on top of this. */
const TIMEOUT_MS = 30_000;

async function readError(res: Response): Promise<string> {
  let code = `HTTP ${res.status}`;
  let detail = "";
  try {
    const body = (await res.json()) as {
      error?: string;
      error_description?: string;
      fields?: { field?: string; message?: string }[];
    };
    if (body.error) code = body.error;
    detail = body.error_description ?? "";
    if (Array.isArray(body.fields) && body.fields.length > 0) {
      detail = body.fields.map((f) => `${f.field}: ${f.message}`).join("; ");
    }
  } catch {
    // A proxy answers HTML, not JSON. Reading the error must not itself raise,
    // or the real status is lost behind a parse failure.
  }
  return detail ? `${code} — ${detail}` : code;
}

function headersFor(
  bearer: string,
  idempotencyKey?: string
): Record<string, string> {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${bearer}`,
    ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
  };
}

export async function createOrder(
  baseUrl: string,
  bearer: string,
  body: CreateOrderBody,
  deps: LaneApiDeps = {},
  idempotencyKey?: string
): Promise<OrderCreated> {
  const doFetch = deps.fetchImpl ?? fetch;
  const res = await doFetch(`${baseUrl}/agent/v1/orders`, {
    method: "POST",
    headers: headersFor(bearer, idempotencyKey),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new LaneApiError(await readError(res));
  return (await res.json()) as OrderCreated;
}

export async function getOrder(
  baseUrl: string,
  bearer: string,
  orderId: string,
  deps: LaneApiDeps = {},
  waitSeconds?: number
): Promise<OrderStatus> {
  const doFetch = deps.fetchImpl ?? fetch;
  const q = waitSeconds ? `?wait=${waitSeconds}` : "";
  const res = await doFetch(
    `${baseUrl}/agent/v1/orders/${encodeURIComponent(orderId)}${q}`,
    {
      method: "GET",
      headers: headersFor(bearer),
      // The API long-polls for up to `wait` seconds before answering, so the
      // client must outlast it or a working long poll reads as a timeout.
      signal: AbortSignal.timeout(TIMEOUT_MS + (waitSeconds ?? 0) * 1000),
    }
  );
  if (!res.ok) throw new LaneApiError(await readError(res));
  return (await res.json()) as OrderStatus;
}
