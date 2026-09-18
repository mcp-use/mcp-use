/**
 * UCP: find merchants, browse their catalogs, and get a checkout link.
 *
 * ── THE ONE THING TO UNDERSTAND ─────────────────────────────────────────────
 *
 * LANE DOES NOT BUILD THE CHECKOUT URL. The merchant hands one back, prefilled,
 * on the variant: `https://www.fit2run.com/cart/51232963658037:1?_gsid=...`.
 * Constructing `/cart/{variant}:{qty}` ourselves would look identical and lose
 * the `_gsid` the seller uses to attribute the session, so the rule is that a
 * checkout link is READ from the response, never assembled.
 *
 * ── TWO ENDPOINTS, AND THEY ARE NOT INTERCHANGEABLE ─────────────────────────
 *
 * `catalog.shopify.com/api/ucp/mcp` is Shopify's AGGREGATED catalog: products
 * from many sellers, and the only one of the two whose variants carry
 * `checkout_url`, `seller` and `eligible`. It is what `ucp_search_products`
 * uses, because a checkout link is the point of that tool.
 *
 * A PER-MERCHANT endpoint (`<store>/api/ucp/mcp`) searches one store, and its
 * variants carry NO `checkout_url` -- verified against a live store, where
 * `get_product` returned a variant with `id, sku, title, description, price,
 * availability, options, media` and nothing else. So `ucp_browse_merchant`
 * cannot promise a link, and says so rather than returning null fields that
 * read like a failure.
 *
 * ── EVERY CALL MUST IDENTIFY THE AGENT ──────────────────────────────────────
 *
 * A `tools/call` without an agent profile is refused outright:
 *
 *     -32001 "UCP discovery failed"
 *     {"code": "invalid_profile_url",
 *      "content": "Unable to fetch agent profile: Missing profile uri"}
 *
 * The profile URI goes in `arguments.meta["ucp-agent"].profile`, which is the
 * only place the endpoint reads it -- not a header, not a top-level param. This
 * cost a confusing hour the first time and the error names none of that, so it
 * is injected centrally in `ucpToolsCall` and no caller can forget it.
 *
 * ── WHAT THIS DELIBERATELY CANNOT DO ────────────────────────────────────────
 *
 * The merchant endpoints expose 13 tools. This module calls FOUR:
 * `search_catalog`, `get_product` (read-only), and `create_checkout` (see
 * `getPaymentUrl` at the bottom, which creates a checkout session).
 *
 * `create_checkout` CREATES STATE and moves NO MONEY -- it is how the spec hands
 * back a handoff URL, and the session it opens expires on its own. That line is
 * where the boundary sits, and `complete_checkout` is on the other side of it:
 * it spends money, and on a UCP merchant Lane cannot undo it, because
 * `cancel_order` and `refund_order` require a signed JWT Lane does not have. So
 * nothing here completes a checkout, and a test asserts the tool surface exactly
 * so nothing starts to. Paying is Lane MCP's job, behind an approved intent.
 */

/** Lane's public agent profile. Merchants fetch this on every call to see who
 *  is asking; it advertises no payment handlers, so it cannot settle an order. */
const AGENT_PROFILE =
  process.env.UCP_AGENT_PROFILE_URL ??
  "https://www.getonlane.com/.well-known/ucp-agent-profile.json";

/**
 * A SECOND PROFILE, AND IT IS NOT REDUNDANCY.
 *
 * A merchant gates its CALLABLE SURFACE on the capabilities the calling profile
 * declares. Measured against a live endpoint: with `AGENT_PROFILE` above (which
 * declares `dev.ucp.shopping.catalog.search`, `.catalog.lookup` and
 * `dev.shopify.catalog.global`), `create_checkout` answers
 *
 *     -32602 Invalid params  "Tool not found: create_checkout"
 *
 * even though `tools/list` on that same endpoint advertises it. "Not found"
 * meaning "not declared in your profile" is the single most misleading error on
 * this path, and it is why the catalog profile cannot simply be reused here.
 *
 * This one declares `dev.ucp.shopping.cart` and `.checkout`, so checkout methods
 * resolve. It still advertises NO payment handlers, which is deliberate: that is
 * what makes a merchant answer `requires_escalation` and hand back a handoff URL
 * instead of expecting Lane to pay.
 */
const CHECKOUT_PROFILE =
  process.env.UCP_CHECKOUT_PROFILE_URL ??
  "https://discovery.getonlane.com/.well-known/ucp-agent";

/** Shopify's cross-seller catalog. The endpoint with `checkout_url`. */
const CATALOG_ENDPOINT =
  process.env.UCP_CATALOG_ENDPOINT ?? "https://catalog.shopify.com/api/ucp/mcp";

/** Lane's UCP index: ~18.6k merchant profiles, searchable by what they sell. */
const DISCOVERY_BASE =
  process.env.LANE_DISCOVERY_BASE ?? "https://discovery.getonlane.com";

/** Merchant catalogs are somebody else's server on the open internet. A hung
 *  request has to fail the tool call rather than hold it open; 30s is chosen
 *  from observed catalog latency, which routinely exceeds ten seconds. */
const TIMEOUT_MS = 30_000;

export type UcpDeps = { fetchImpl?: typeof fetch };

/**
 * Parse a `tools/call` response, which arrives as EITHER plain JSON or as an
 * SSE frame (`event: message\ndata: {...}`) depending on the endpoint and,
 * occasionally, on the same endpoint's mood. Both are legal streamable-HTTP
 * responses, so a client that handles only one works until it does not.
 */
function parseRpc(body: string): Record<string, unknown> | null {
  const trimmed = body.trim();
  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  for (const line of trimmed.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try {
      return JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
    } catch {
      // A `data:` line that is not JSON is a keep-alive or a partial frame.
    }
  }
  return null;
}

export class UcpError extends Error {}

/** An MCP `tools/call` result. `isError` is the tool's own verdict on itself;
 *  the sentence explaining it lives in the text content blocks, never in
 *  `structuredContent`, which an errored call does not carry. */
type ToolResult = {
  isError?: boolean;
  content?: unknown;
  structuredContent?: Record<string, unknown>;
};

/**
 * EVERY REFUSAL MESSAGE IS CAPPED, AND THE CAP IS THE SECURITY CONTROL.
 *
 * A refusal travels: merchant -> `UcpError.message` -> `answering()` in
 * `ucp-tools.ts` -> `{error}` in a tool result -> an agent's context window.
 * Nothing downstream truncates it. So an uncapped message hands a third party
 * on the open internet a write primitive into a model's context, and a
 * merchant that is merely broken can do the same damage as one that is
 * hostile: return a megabyte of text and the agent's own instructions get
 * pushed out of the window.
 *
 * A useful refusal is one sentence ("Missing required arguments: cart"). 500
 * characters is already generous, and the two caps are separate on purpose --
 * the block count bounds the join before it allocates, the length bounds what
 * the join produced.
 *
 * This does NOT make merchant text safe to trust. It is still third-party
 * prose arriving in a model's context, and it is surfaced deliberately because
 * a diagnostic beats a false "no results". The cap bounds the blast radius; it
 * is not a sanitiser.
 */
const MAX_REFUSAL_BLOCKS = 20;
const MAX_REFUSAL_CHARS = 500;

/** The merchant's sentence, joined from the text blocks. Several blocks is
 *  legal and each is a line of one message, so they are joined rather than
 *  picked between. Null when a merchant set `isError` and said nothing -- the
 *  caller substitutes its own words rather than reporting an empty refusal. */
function contentText(result: ToolResult): string | null {
  const blocks = Array.isArray(result.content) ? result.content : [];
  const lines = blocks
    .slice(0, MAX_REFUSAL_BLOCKS)
    .map((b) => b as { type?: unknown; text?: unknown } | null)
    .filter((b) => b !== null && b.type === "text")
    .map((b) => str(b!.text))
    .filter((t): t is string => t !== null);
  return lines.length > 0 ? clamp(lines.join(" ")) : null;
}

/** Bound anything a merchant wrote before it becomes an error message. */
function clamp(text: string): string {
  return text.length <= MAX_REFUSAL_CHARS
    ? text
    : `${text.slice(0, MAX_REFUSAL_CHARS)}...`;
}

/**
 * One `tools/call` against a UCP endpoint, returning `result.structuredContent`.
 *
 * Errors are RAISED WITH THE MERCHANT'S OWN MESSAGE rather than flattened to
 * null. A UCP refusal is specific and actionable -- a missing profile, an
 * ineligible region, a catalog that is not enabled -- and a caller that got
 * `null` would report "no results" for all of them, which is the one answer
 * that is never true.
 *
 * ── ERRORS ARRIVE IN TWO PLACES, AND BOTH ARE CHECKED ───────────────────────
 *
 * The transport is JSON-RPC, so a TRANSPORT failure -- a method that does not
 * exist, a profile that will not resolve -- comes back as `error`. But a tool
 * that ran and refused is a SUCCESSFUL JSON-RPC call: MCP puts that outcome in
 * `result.isError` with the sentence in `result.content[].text`. Validation and
 * business errors take the second channel.
 *
 * Checking only `error` is a bug with a very quiet failure mode, and it is one
 * this client shipped: an `isError` response has no `structuredContent`, so it
 * flattened to `{}`, `browseMerchant` returned `[]`, and a merchant that FAILED
 * became indistinguishable from a merchant that stocks NOTHING. The one
 * distinction anything measuring this path exists to make.
 * `docs/designs/2026-08-23-ucp-payment-url-reliability.md` §"one transport
 * lesson" is where it was first written down.
 */
async function ucpToolsCall(
  endpoint: string,
  name: string,
  args: Record<string, unknown>,
  deps: UcpDeps,
  /** Which agent profile to present. Defaults to the catalog one; checkout
   *  methods must pass `CHECKOUT_PROFILE` or the merchant reports them as not
   *  found. See the comment on that constant. */
  profile: string = AGENT_PROFILE
): Promise<Record<string, unknown>> {
  const doFetch = deps.fetchImpl ?? fetch;
  const res = await doFetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      // THE PROFILE, INJECTED HERE AND NOWHERE ELSE. See the header note.
      params: {
        name,
        arguments: { meta: { "ucp-agent": { profile } }, ...args },
      },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok)
    throw new UcpError(`${new URL(endpoint).host} returned HTTP ${res.status}`);

  const parsed = parseRpc(await res.text());
  if (!parsed)
    throw new UcpError(
      `${new URL(endpoint).host} returned a response that was not JSON-RPC`
    );

  const err = parsed.error as
    | { message?: string; data?: { content?: string } }
    | undefined;
  if (err) {
    // Clamped for the same reason as the `isError` path below, which it
    // predates: this field is merchant-written too, and nothing capped it.
    const detail = clamp(err.data?.content ?? err.message ?? "unknown error");
    throw new UcpError(`${name} refused: ${detail}`);
  }

  const result = parsed.result as ToolResult | undefined;
  // A tool that ran and refused. `isError` is the ONLY signal -- the JSON-RPC
  // envelope says success, and `structuredContent` is simply absent, which is
  // also what an empty catalog looks like. Raise, so the caller can tell them
  // apart. Checked BEFORE the return, because the return cannot.
  if (result?.isError)
    throw new UcpError(
      `${name} refused: ${contentText(result) ?? "unknown error"}`
    );

  return result?.structuredContent ?? {};
}

/** Money arrives as minor units plus a currency (`{amount: 39990, currency:
 *  "NZD"}`). Rendered as a string rather than a float: a price is a decimal
 *  quantity and binary floating point is the wrong shape for one. */
function money(v: unknown): string | null {
  const m = v as { amount?: unknown; currency?: unknown } | null;
  if (!m || typeof m.amount !== "number" || typeof m.currency !== "string")
    return null;
  return `${(m.amount / 100).toFixed(2)} ${m.currency}`;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

/**
 * NULL FOR ANYTHING THAT IS NOT A BOOLEAN, and the coercion that is deliberately
 * NOT here is `Boolean(v)`.
 *
 * The index only began reporting `all_terms` in 2026-08; an older deployment
 * omits it. `Boolean(undefined)` is `false`, and `false` on this field is a
 * CLAIM -- "your whole query did not match" -- so a truthiness cast would have
 * this tool assert something the index never said, on every merchant, silently.
 * Null means no signal, which is the truth in that case.
 */
function boolOrNull(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

/** Same reasoning as `boolOrNull`: absent must not become 0. `all_terms_count:
 *  0` is the strongest thing this tool can say, and an old index saying nothing
 *  must not be reported as it. */
function intOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) ? v : null;
}

export type UcpProduct = {
  title: string | null;
  price: string | null;
  seller: string | null;
  /** The prefilled hosted checkout, READ from the variant. Null on a
   *  per-merchant endpoint, which does not carry one. */
  checkout_url: string | null;
  product_url: string | null;
  variant_id: string | null;
  available: boolean | null;
  image_url: string | null;
};

/** `gid://shopify/ProductVariant/123` -> `123`. The numeric tail is what a cart
 *  permalink names, so it is worth surfacing even when the URL is built for us. */
/** The variant id AS THE MERCHANT GAVE IT.
 *
 *  This used to return `id.split('/').pop()`, and that broke the buy flow.
 *  `create_cart` requires a full GID and says so: `invalid_input`,
 *  "is not a valid ProductVariant GID (got: \"42897333584033\")", severity
 *  unrecoverable -- measured on four live merchants, 4 of 4, 2026-08-31. So
 *  `ucp_search_products` handed agents a value `ucp_get_payment_url` could not
 *  use, and Lane's own tool descriptions walked them into it.
 *
 *  The bare number is real, but it belongs to the cart PERMALINK, which this
 *  file's header says Lane reads and never assembles. Nothing here builds one. */
function variantId(v: Record<string, unknown>): string | null {
  return str(v.id);
}

function firstImage(
  product: Record<string, unknown>,
  variant: Record<string, unknown>
): string | null {
  for (const source of [variant.media, product.media]) {
    if (!Array.isArray(source)) continue;
    for (const item of source) {
      const url = str((item as { url?: unknown })?.url);
      if (url) return url;
    }
  }
  return null;
}

/** Flatten a UCP product to its first variant. One row per product is what a
 *  reader wants from a search; the variant carries the link and the price. */
function flatten(product: Record<string, unknown>): UcpProduct {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const variant = (variants.find((v) => typeof v === "object" && v !== null) ??
    {}) as Record<string, unknown>;
  const seller = variant.seller as { url?: unknown } | undefined;
  const range = product.price_range as { min?: unknown } | undefined;
  const availability = variant.availability as
    | { available?: unknown }
    | undefined;
  return {
    title: str(product.title),
    price: money(variant.price) ?? money(range?.min),
    seller: str(seller?.url),
    checkout_url: str(variant.checkout_url),
    product_url: str(variant.url) ?? str(product.url),
    variant_id: variantId(variant),
    available:
      typeof availability?.available === "boolean"
        ? availability.available
        : null,
    image_url: firstImage(product, variant),
  };
}

function productsFrom(sc: Record<string, unknown>): UcpProduct[] {
  const products = Array.isArray(sc.products) ? sc.products : [];
  return products
    .filter(
      (p): p is Record<string, unknown> => typeof p === "object" && p !== null
    )
    .map(flatten);
}

/**
 * Search Shopify's cross-seller catalog. The only path that yields a checkout
 * link, so it is the one an agent trying to buy something should take.
 *
 * `ships_to` defaults to US because the filter is not optional in practice: an
 * unfiltered search returns products no US buyer can complete, and "eligible"
 * is decided by the seller rather than by us.
 */
export async function searchProducts(
  query: string,
  opts: { country?: string; limit?: number },
  deps: UcpDeps = {}
): Promise<UcpProduct[]> {
  const sc = await ucpToolsCall(
    CATALOG_ENDPOINT,
    "search_catalog",
    {
      catalog: {
        query,
        filters: {
          ships_to: { country: opts.country ?? "US" },
          available: true,
        },
      },
    },
    deps
  );
  return productsFrom(sc).slice(0, opts.limit ?? 10);
}

/**
 * Search ONE merchant's catalog.
 *
 * Returns no `checkout_url`, and that is the endpoint's behaviour rather than a
 * gap here -- see the header. Use it to see what a specific store carries; use
 * `searchProducts` when the goal is to actually check out.
 */
export async function browseMerchant(
  endpointUrl: string,
  query: string,
  opts: { limit?: number },
  deps: UcpDeps = {}
): Promise<UcpProduct[]> {
  const url = new URL(endpointUrl); // throws on a malformed endpoint
  if (url.protocol !== "https:")
    throw new UcpError("merchant endpoint must be https");
  const sc = await ucpToolsCall(
    endpointUrl,
    "search_catalog",
    { catalog: { query, filters: { available: true } } },
    deps
  );
  return productsFrom(sc).slice(0, opts.limit ?? 10);
}

export type LaneMerchant = {
  hostname: string;
  brand: string | null;
  summary: string | null;
  endpoint_url: string | null;
  execution: string | null;
  tier: string | null;
  platform: string | null;
  categories: string[];
  /** Every term of the query matched THIS merchant, rather than the index's `|`
   *  relaxation matching some of them. Null under a hostname lookup, which has
   *  no query to have matched -- and null from an index too old to report it. */
  all_terms: boolean | null;
  /** The index put this row first because the query NAMED the merchant and its
   *  own catalog corroborated the rest. Survives the partial_matches split. */
  brand_promoted: boolean;
};

export type LaneMerchantSearch = {
  merchants: LaneMerchant[];
  /**
   * How many results matched the ENTIRE query. Null when the index did not say.
   *
   * ZERO IS THE INFORMATIVE VALUE and it is sound, not merely true of this page:
   * the index sorts every full match ahead of every partial one, so a zero means
   * no merchant anywhere in the match set matched every term -- not just none in
   * the rows returned. A non-zero count is only a lower bound; more may sit past
   * `limit`.
   */
  all_terms_count: number | null;
  /**
   * How many merchants the `execution` filter hid, per protocol. Null when
   * nothing was hidden, or when the index did not say.
   *
   * It exists because the filter has a DEFAULT. Without this field an agent
   * cannot tell "nobody sells this" from "twelve sell it and the tools here can
   * drive none of them", and only the second is worth telling a human about.
   */
  excluded_execution: Record<string, number> | null;
};

/**
 * Lane's own index of UCP merchants, searched by what they sell.
 *
 * A DIFFERENT QUESTION from `searchProducts`, which is why it is a separate
 * tool rather than a mode: this answers "who sells this", over merchant
 * profiles, and returns the endpoint you would then browse. Shopify's catalog
 * answers "which product", and cannot tell you a store exists until one of its
 * products matches.
 *
 * WHY THE RETURN IS AN OBJECT AND NOT AN ARRAY. The index relaxes its query
 * from AND to OR, so a search naming something it has never heard of does not
 * come back empty -- it drops that term and answers the rest. Measured over 247
 * queries: 70% of brand+product searches returned a full page in which nothing
 * matched the whole query. `dyson vacuum` returns 36 merchants and not one of
 * them is known to stock Dyson.
 *
 * An array cannot carry that. A caller handed 36 rows has no way to tell a real
 * answer from a relaxed one, and the caller here is an AGENT -- a person seeing
 * 36 vacuum stores notices there is no Dyson, an agent browses all 36.
 */
export async function findMerchants(
  query: string,
  opts: {
    limit?: number;
    hostname?: string;
    preferCategory?: string[];
    execution?: "mcp" | "api" | "any";
  },
  deps: UcpDeps = {}
): Promise<LaneMerchantSearch> {
  const doFetch = deps.fetchImpl ?? fetch;
  const url = new URL("/merchants", DISCOVERY_BASE);
  if (opts.hostname) url.searchParams.set("hostname", opts.hostname);
  else url.searchParams.set("q", query);
  url.searchParams.set("limit", String(opts.limit ?? 10));
  // RANKS, does not filter -- so a wrong guess costs the caller nothing but a
  // slightly worse ordering. Repeated rather than comma-joined: the index reads
  // it as a repeated query parameter and validates each value against the same
  // closed vocabulary `category=` uses, answering 422 on anything outside it.
  for (const c of opts.preferCategory ?? [])
    url.searchParams.append("prefer_category", c);
  // 'any' OMITS the parameter rather than sending a third value. The index
  // accepts only `mcp` and `api` and answers 422 on anything else, so "no
  // filter" has to be the absence of the field.
  if (opts.execution && opts.execution !== "any") {
    url.searchParams.set("execution", opts.execution);
  }

  const res = await doFetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new UcpError(`the Lane index returned HTTP ${res.status}`);
  const body = (await res.json()) as {
    results?: unknown[];
    all_terms_count?: unknown;
    excluded?: { execution?: unknown };
  };
  const rows = Array.isArray(body.results) ? body.results : [];
  // The index sends `{}` when it excluded nothing, and an older one sends
  // nothing at all. Both mean "no exclusion to report", and an empty object
  // reads as a claim an agent would then have to unpack.
  const ex = body.excluded?.execution;
  const excludedExecution =
    typeof ex === "object" && ex !== null && Object.keys(ex).length > 0
      ? (ex as Record<string, number>)
      : null;
  return {
    merchants: rows
      .filter(
        (r): r is Record<string, unknown> => typeof r === "object" && r !== null
      )
      .map((r) => ({
        hostname: str(r.hostname) ?? "",
        brand: str(r.brand),
        summary: str(r.summary),
        endpoint_url: str(r.endpoint_url),
        execution: str(r.execution),
        tier: str(r.tier),
        platform: str(r.platform),
        categories: Array.isArray(r.categories)
          ? r.categories.filter((c): c is string => typeof c === "string")
          : [],
        all_terms: boolOrNull(r.all_terms),
        brand_promoted: r.brand_promoted === true,
      })),
    all_terms_count: intOrNull(body.all_terms_count),
    excluded_execution: excludedExecution,
  };
}

/**
 * One follow-up action, reported to the index as a ranking label.
 *
 * FIRE-AND-FORGET BY DESIGN: a label is worth zero added latency and zero added
 * failure modes on the call that produced it. Nothing awaits it, and every error
 * is swallowed.
 *
 * The index gates `/events` with a shared secret and fails closed without one,
 * so an unkeyed post is a guaranteed 503 -- this sends nothing at all instead.
 */
export function reportEvent(
  kind: "browse" | "payment_url",
  endpointUrl: string,
  deps: UcpDeps = {}
): void {
  const key = process.env.LANE_EVENTS_KEY;
  if (!key) return;
  try {
    const hostname = new URL(endpointUrl).hostname;
    const doFetch = deps.fetchImpl ?? fetch;
    void doFetch(new URL("/events", DISCOVERY_BASE), {
      method: "POST",
      headers: { "content-type": "application/json", "x-lane-events": key },
      body: JSON.stringify({ kind, hostname }),
      signal: AbortSignal.timeout(1_000),
    }).catch(() => {});
  } catch {
    // A malformed endpoint_url loses a label, nothing more.
  }
}

/** The fan-out gets its own, SHORTER deadline. `TIMEOUT_MS` is 30s, which is
 *  right for one call and wrong for five in parallel: at 30s a single hung
 *  merchant holds the whole tool call far past any budget an agent will wait
 *  for. The index answers in tens of milliseconds; a merchant catalog routinely
 *  takes several seconds, so 6s keeps the slow ones and drops the hung ones. */
const CONFIRM_TIMEOUT_MS = 6_000;

/** How many candidates get a live call. Each one is a request to somebody
 *  else's server carrying Lane's agent profile, so this is politeness as much
 *  as latency. */
const CONFIRM_DEFAULT = 5;

export type LaneProductRow = UcpProduct & {
  hostname: string;
  endpoint_url: string | null;
  /** What the crawl recorded, kept beside the live title so a mismatch is
   *  visible rather than silently resolved. */
  indexed_title: string;
  observed_at: string | null;
  confirmed: boolean;
};

export type LaneProductSearch = {
  products: LaneProductRow[];
  /** False when no single product title matched every term and the index
   *  answered a relaxed version of the query. */
  strict: boolean;
  /** The index's match set passed its ranking cap, so these sellers are a
   *  SAMPLE of the ones that carry the product. True only on broad queries. */
  capped: boolean;
  /** Candidates whose live catalog did not return the product, or did not
   *  answer. They are dropped, not shown; the count is the staleness signal. */
  unconfirmed: number;
};

/**
 * Find one product across Lane's whole merchant corpus, with a live price and a
 * variant id.
 *
 * TWO STEPS, AND THE SECOND IS THE POINT. Lane's index supplies recall from 32
 * million crawled titles. It holds no price, no availability and no variant id,
 * and nothing re-crawls it yet -- so every candidate is confirmed against the
 * merchant's own `search_catalog` before it is returned. A merchant that no
 * longer carries the product is dropped here, which is what keeps a stale index
 * from ever reaching a shopper.
 *
 * The confirm call sends the title the INDEX holds, not the caller's phrasing.
 * The index knows the exact string that merchant uses, and re-sending
 * "nalgene 32oz" throws away the only thing the index lookup learned.
 *
 * NO `country` PARAMETER, deliberately. `ships_to` is verified on the
 * aggregator endpoint and unverified on a per-merchant one -- `browseMerchant`
 * does not send it either -- and an unrecognised filter risks a refusal from
 * every merchant. Filter by eligibility after `ucp_get_payment_url`, which does
 * take a country.
 */
export async function findProduct(
  query: string,
  opts: { limit?: number; confirm?: number },
  deps: UcpDeps = {}
): Promise<LaneProductSearch> {
  const doFetch = deps.fetchImpl ?? fetch;
  const confirm = opts.confirm ?? CONFIRM_DEFAULT;

  const url = new URL("/products", DISCOVERY_BASE);
  url.searchParams.set("q", query);
  // ASKED FOR EXACTLY WHAT WILL BE CONFIRMED. A larger page would mean rows the
  // caller never sees, and every candidate costs a request to a third party.
  url.searchParams.set("limit", String(confirm));

  const res = await doFetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new UcpError(`the Lane index returned HTTP ${res.status}`);
  const body = (await res.json()) as {
    results?: unknown[];
    strict?: unknown;
    capped?: unknown;
  };
  const rows = (Array.isArray(body.results) ? body.results : []).filter(
    (r): r is Record<string, unknown> => typeof r === "object" && r !== null
  );
  const strict = body.strict !== false;
  const capped = body.capped === true;

  const confirmed = await Promise.allSettled(
    rows.map(async (r): Promise<LaneProductRow> => {
      const endpoint = str(r.endpoint_url);
      const indexedTitle = str(r.title) ?? query;
      if (!endpoint) throw new UcpError("index row carried no endpoint_url");
      const sc = await ucpToolsCall(
        endpoint,
        "search_catalog",
        { catalog: { query: indexedTitle, filters: { available: true } } },
        { ...deps, fetchImpl: withTimeout(doFetch, CONFIRM_TIMEOUT_MS) }
      );
      // THE TITLE MUST MATCH, and taking `products[0]` was a bug.
      // `search_catalog` is a SEARCH: asked for a product the merchant dropped,
      // it returns its best other match rather than nothing. Verified against a
      // live store -- a title no merchant carries came back "confirmed" with a
      // real price for a different tent. That turns the confirm step from
      // staleness protection into a way to present the wrong product at the
      // wrong price as the thing the buyer asked for.
      //
      // Equality is the right test rather than a loose one, because the index's
      // title CAME FROM this same `search_catalog` during the crawl. A mismatch
      // means the merchant renamed or dropped it, which is exactly the signal.
      const live = productsFrom(sc).find((c) =>
        sameTitle(c.title, indexedTitle)
      );
      // An empty catalog, a dropped product and a renamed one are all the same
      // response, so all three read as "not confirmed". Guessing which would be
      // worse than dropping.
      if (!live)
        throw new UcpError("the merchant no longer returns this product");
      return {
        ...live,
        hostname: str(r.hostname) ?? "",
        endpoint_url: endpoint,
        indexed_title: indexedTitle,
        observed_at: str(r.observed_at),
        confirmed: true,
      };
    })
  );

  const products = confirmed
    .filter(
      (c): c is PromiseFulfilledResult<LaneProductRow> =>
        c.status === "fulfilled"
    )
    .map((c) => c.value)
    .slice(0, opts.limit ?? 10);

  // THE INDEX SAID YES AND THE MERCHANT SAID NO. One observation of catalog
  // staleness per line, which is the measurement phase 2 of
  // docs/plans/2026-08-31-after-the-catalog.md plans to buy with a re-crawl.
  // Warn rather than error: a merchant dropping a product is normal.
  confirmed.forEach((c, i) => {
    if (c.status === "fulfilled") return;
    console.warn(
      JSON.stringify({
        event: "product_unconfirmed",
        hostname: str(rows[i]?.hostname),
        observed_at: str(rows[i]?.observed_at),
        reason: c.reason instanceof Error ? c.reason.message : "unknown",
      })
    );
  });

  return {
    products,
    strict,
    capped,
    unconfirmed: confirmed.length - products.length,
  };
}

/** Case and whitespace only. Anything looser would re-admit the near-miss this
 *  exists to reject: two different products in one store often differ by a size
 *  or a colour and nothing else. */
function sameTitle(live: string | null, indexed: string): boolean {
  const norm = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ");
  return live !== null && norm(live) === norm(indexed);
}

/** Apply the fan-out's shorter deadline even though `ucpToolsCall` sets its own
 *  signal. The spread puts this one last, so it wins. */
function withTimeout(inner: typeof fetch, ms: number): typeof fetch {
  return ((
    url: Parameters<typeof fetch>[0],
    init: Parameters<typeof fetch>[1]
  ) =>
    inner(url, { ...init, signal: AbortSignal.timeout(ms) })) as typeof fetch;
}

/**
 * ── THE SPEC-NATIVE PAYMENT URL ─────────────────────────────────────────────
 *
 * `searchProducts` above reads `variant.checkout_url`, which works and is the
 * wrong thing to depend on. This is the durable path, and the difference is not
 * stylistic:
 *
 *   `checkout_url` / `eligible` / `_gsid` appear NOWHERE in the UCP spec. They
 *   are Shopify extensions on the `catalog.shopify.com` aggregator -- checked
 *   against https://ucp.dev/2026-04-08/schemas/shopping/catalog_lookup.json,
 *   which mentions none of them. Vendor surfaces on this path already churn:
 *   Shopify's own `/api/mcp` is deprecated with a hard cutoff of 2026-08-31.
 *
 *   `continue_url` IS in the spec
 *   (https://ucp.dev/2026-04-08/schemas/shopping/checkout.json) and carries a
 *   guarantee: "URL for checkout handoff and session recovery. MUST be provided
 *   when status is requires_escalation." `create_checkout` is one of the 13
 *   canonical methods in the spec's OpenRPC document, and those 13 are exactly
 *   what a merchant endpoint advertises.
 *
 * So this asks the MERCHANT'S OWN endpoint for a checkout and reads the URL the
 * spec obliges it to provide. No aggregator, no undocumented query parameter, no
 * host to guess.
 *
 * NO PAYMENT CREDENTIAL IS INVOLVED. `payment` is `create: optional` in the
 * schema and `line_items` is the only required field, so this obtains a real
 * checkout session while advertising no ability to pay -- which is precisely the
 * handoff case: `requires_escalation` means "a human or a browser finishes
 * this", and that is what Lane MCP's formfill does with the URL.
 *
 * ── THE PROFILE MUST DECLARE THE CAPABILITY ─────────────────────────────────
 *
 * Measured: with a catalog-only profile, `create_checkout` on a live merchant
 * returns `-32602 Invalid params / "Tool not found: create_checkout"` -- while
 * `tools/list` on the same endpoint advertises it. The callable surface is gated
 * on what the AGENT PROFILE declares, and the error says "not found" rather than
 * "not permitted", which is a full afternoon of looking in the wrong place. The
 * profile at `UCP_AGENT_PROFILE_URL` must declare `dev.ucp.shopping.checkout`
 * for this function to work at all, so it is asserted here rather than left to
 * fail as a missing tool.
 */

/** Statuses that mean "there is a real checkout session behind this URL".
 *  From the spec's enum: incomplete | requires_escalation | ready_for_complete |
 *  complete_in_progress | completed | canceled. Only consulted on the checkout
 *  method; a cart has no status (see `method` below). */
const USABLE_STATUS = new Set(["requires_escalation", "ready_for_complete"]);

/**
 * CART OR CHECKOUT, AND CART IS THE DEFAULT ON MEASUREMENT.
 *
 * Both return a `continue_url` for the same line item. The first version of this
 * function used `create_checkout` because that is where the spec writes the MUST
 * -- and a reliability study then measured both across 48 merchants
 * (docs/designs/2026-08-23-ucp-payment-url-reliability.md) and found the cart
 * path strictly better for this one job:
 *
 *   * 41/41 = 100% of merchants indexed Shopify / execution=mcp / tier=checkout.
 *   * `create_cart` returns `messages: []` and NO STATUS -- nothing to
 *     interpret, so it has fewer failure modes for an identical URL. The
 *     checkout path instead lands in `requires_escalation` with an
 *     `extension_interaction_required` message on 16/20, which is noise when all
 *     you wanted was the link.
 *   * It works on stores absent from the aggregated catalog, and does not
 *     traverse that Cloudflare-fronted aggregator at all.
 *
 * `checkout` is kept, not deleted, because it returns things a cart does not:
 * the spec `status`, the merchant's diagnostic `messages`, and the
 * `payment_handlers` envelope -- the only place a merchant states what paying it
 * natively would require. Ask for it when you want to know WHY, rather than
 * WHERE.
 */
export type PaymentUrlMethod = "cart" | "checkout";

export type PaymentUrl = {
  /**
   * The spec's handoff URL. Null when the merchant did not provide one.
   *
   * IT NEEDS A COOKIE-CAPABLE CLIENT, and this is not obvious from the URL.
   * Fetched WITHOUT a cookie jar it 301s to the storefront and then lands on the
   * shop's HOME PAGE with HTTP 200 -- which reads exactly like a working link to
   * anything checking status codes, and is how this was briefly mistaken for
   * broken. Followed WITH cookies the same URL resolves properly:
   *
   *   <shop>.myshopify.com/cart/c/<token>?key=  301 -> the storefront domain
   *                                             302 -> shop.app/.../shoppay
   *                                             302 -> /checkouts/cn/<token>
   *                                             200    a real checkout page
   *
   * Verified end to end: that final page carried the product name, the price,
   * the subtotal and the order summary. A browser is cookie-capable, so the
   * formfill handoff is unaffected -- but a health check that just curls this
   * will always pass while proving nothing.
   */
  payment_url: string | null;
  /** Which method produced it. */
  method: PaymentUrlMethod;
  /** The spec status. `requires_escalation` is the expected value for an agent
   *  that advertises no payment handler. ALWAYS NULL on the cart method, which
   *  has no status -- that absence is the reason to prefer it. */
  status: string | null;
  /** True only when a status says a session exists AND nothing unrecoverable
   *  was reported. A non-null url is NOT sufficient -- see `usable` below. */
  usable: boolean;
  /** The merchant-side checkout id, for `get_checkout` later. */
  checkout_id: string | null;
  expires_at: string | null;
  totals: { type: string; amount: number; display_text?: string }[];
  /** The merchant's own diagnostics -- what is missing, what is fatal. Carried
   *  through verbatim because "Missing a valid contact method" is actionable and
   *  a boolean is not. */
  messages: { code?: string; content?: string; severity?: string }[];
  /** The payment handlers this merchant accepts, harvested from the response
   *  envelope. Not needed for the handoff; recorded because it is the only
   *  place a merchant states what it would take to pay it natively. */
  payment_handlers: string[];
};

/**
 * Ask a merchant for a checkout and return the URL the spec obliges it to give.
 *
 * A DEAD VARIANT STILL RETURNS A URL, which is the trap here: an out-of-stock
 * item comes back with `continue_url` pointing at the bare storefront root and a
 * message of `code: out_of_stock, severity: unrecoverable`. So "we got a URL" is
 * not the success condition -- `usable` is, and it requires both a session-
 * bearing status and the absence of an unrecoverable message.
 */
export async function getPaymentUrl(
  endpointUrl: string,
  variantId: string,
  opts: {
    quantity?: number;
    method?: PaymentUrlMethod;
    country?: string;
    currency?: string;
  },
  deps: UcpDeps = {}
): Promise<PaymentUrl> {
  const url = new URL(endpointUrl);
  if (url.protocol !== "https:")
    throw new UcpError("merchant endpoint must be https");

  const method = opts.method ?? "cart";
  const line_items = [
    { item: { id: variantId }, quantity: opts.quantity ?? 1 },
  ];
  // `context` is carried on the cart request because that is the shape measured
  // at 41/41. A cart with no context is not known to work and is not worth
  // finding out about one merchant at a time.
  const context = {
    address_country: opts.country ?? "US",
    currency: opts.currency ?? "USD",
  };

  const sc = await ucpToolsCall(
    endpointUrl,
    method === "cart" ? "create_cart" : "create_checkout",
    method === "cart"
      ? { cart: { line_items, context } }
      : { checkout: { line_items } },
    deps,
    CHECKOUT_PROFILE
  );

  const envelope = (sc.ucp ?? {}) as {
    capabilities?: unknown;
    payment_handlers?: unknown;
  };
  const messages = (
    Array.isArray(sc.messages) ? sc.messages : []
  ) as PaymentUrl["messages"];
  const status = str(sc.status);
  const fatal = messages.some((m) => m.severity === "unrecoverable");
  const paymentUrl = str(sc.continue_url);

  return {
    payment_url: paymentUrl,
    method,
    status,
    // TWO DEFINITIONS, because the two methods report differently. A cart has no
    // status, so a URL with nothing fatal against it IS the success condition;
    // requiring a status there would make every cart unusable. A checkout does
    // have one and it must say a session exists -- `canceled` with a URL is not
    // a checkout. Neither definition accepts a bare URL on its own: a dead
    // variant returns `continue_url` pointing at the storefront root with an
    // `unrecoverable` message, and that is not somewhere to send a buyer.
    usable:
      method === "cart"
        ? paymentUrl !== null && !fatal
        : status !== null && USABLE_STATUS.has(status) && !fatal,
    checkout_id: str(sc.id),
    expires_at: str(sc.expires_at),
    totals: (Array.isArray(sc.totals) ? sc.totals : []) as PaymentUrl["totals"],
    messages,
    payment_handlers:
      typeof envelope.payment_handlers === "object" &&
      envelope.payment_handlers !== null
        ? Object.keys(envelope.payment_handlers)
        : [],
  };
}
