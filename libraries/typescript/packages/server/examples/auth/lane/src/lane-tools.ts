/**
 * Lane checkout, as a tool on this server.
 *
 * WHAT THIS IS NOT: a checkout engine. `POST /agent/v1/orders` on Lane's MCP
 * service is the engine -- it builds an intent, approves it, drives a browser,
 * fills the card and confirms to VGS. These tools are its client.
 *
 * WHOSE ORDER IS IT? The CALLER'S bearer is forwarded, never a server-held
 * credential. Read the single-tenant limitation before deploying this: Lane's
 * agent-token path resolves AUTHORIZATION through one configured delegate API
 * key (`LANE_AGENT_TOKEN_DELEGATE_KEY`), because a Lane agent token's `sub` is
 * pairwise per audience and names no Lane user. So on a shared deployment every
 * order lands on that one Lane account. That is a property of
 * `auth.py:_resolve_agent_token`, not of this file, and it is why the tool
 * description says so out loud.
 *
 * `payment_url` IS A SESSION, NOT A LINK. It expires and it is opaque. A caller
 * that mints one with `ucp_get_payment_url` and sits on it has a dead URL, and
 * Lane cannot tell that from a live one until the browser opens it.
 */
import { z } from "zod";
import {
  createOrder,
  getOrder,
  LaneApiError,
  type LaneApiDeps,
} from "./lane-api.js";

export type LaneDeps = LaneApiDeps & { baseUrl?: string };

const DEFAULT_BASE =
  process.env.LANE_MCP_BASE_URL ?? "https://mcp.getonlane.com";

const shipToSchema = z.object({
  name: z.string().min(1).describe("Recipient full name."),
  line1: z.string().min(1).describe("Street address."),
  line2: z.string().optional(),
  city: z.string().min(1),
  state: z.string().min(1).describe("State, province or region."),
  postal_code: z.string().min(1),
  country: z.string().length(2).describe("ISO 3166-1 alpha-2, e.g. US."),
  // Not optional, and the reason is not validation taste: a merchant's
  // add-address form will not submit without a phone, so an order lacking one
  // loops at checkout rather than failing fast.
  phone: z
    .string()
    .min(7)
    .describe("Required. Checkout address forms will not submit without one."),
});

/**
 * `z.url()` IS NOT A SCHEME CHECK, and on this tool that is the difference
 * between a URL and a payload.
 *
 * Measured against zod 4: `z.string().url()` accepts `javascript:alert(1)`,
 * `file:///etc/passwd` and `data:text/html,...` — it parses, it does not
 * constrain. `payment_url` becomes the Order API's `product_url`, which Lane's
 * headless browser NAVIGATES with the run's card and merchant cookies in
 * context, so an unconstrained scheme hands a caller the browser's own origin.
 *
 * `ucp.ts` already draws this line for the same reason (`merchant endpoint must
 * be https`); this is that rule, at the tool boundary, where the caller is.
 */
const httpsUrl = (what: string) =>
  z
    .string()
    .url()
    .refine((u) => {
      try {
        return new URL(u).protocol === "https:";
      } catch {
        return false;
      }
    }, `${what} must be an https URL`);

const lineSchema = z.object({
  variant_id: z
    .string()
    .min(1)
    .describe("The variant, in the merchant's own id space."),
  title: z
    .string()
    .min(1)
    .describe("The CATALOG's title for the item — not your own words for it."),
  unit_price: z
    .string()
    .describe('Price per item, decimal ("40.00"). From the catalog.'),
  currency: z.string().length(3).optional().describe("Defaults to USD."),
});

/**
 * The ceiling, in integer cents, from the quoted line plus headroom.
 *
 * WHY HEADROOM AT ALL: a UCP cart quote is a SUBTOTAL. Shipping and tax are
 * added by the merchant at checkout and appear nowhere in it, so a ceiling set to
 * the quote refuses nearly every real order at place-order time.
 *
 * WHY THAT IS SAFE: the loose bar is not the only guard. The harvested line
 * arms Lane's per-line check, which compares the approved unit price x quantity
 * against the live cart subtotal EXACTLY. So the bar absorbs shipping and tax
 * while the line check catches a wrong product — two guards doing different
 * jobs. Widening the bar without the line does lose real protection, which is
 * why this returns null when there is no line to derive from.
 *
 * Integer cents throughout: a ceiling is a decimal quantity and binary floating
 * point is the wrong shape for one.
 */
function derivedCeiling(
  unitPrice: string,
  quantity: number,
  headroom: number
): string | null {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(unitPrice.trim());
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
  if (!Number.isFinite(cents) || cents <= 0) return null;
  const total = Math.ceil(cents * quantity * (1 + headroom));
  return `${Math.floor(total / 100)}.${String(total % 100).padStart(2, "0")}`;
}

export const laneCheckoutInputSchema = {
  payment_url: httpsUrl("payment_url").describe(
    "The payment_url returned by ucp_get_payment_url. Use it promptly; it expires."
  ),
  endpoint_url: httpsUrl("endpoint_url").describe(
    "The merchant's UCP endpoint the URL came from. Names the merchant for Lane."
  ),
  line: lineSchema
    .optional()
    .describe(
      "What the catalog said about the item, from ucp_find_product / ucp_get_payment_url. " +
        "Supply it whenever you have it: it is what lets Lane verify the cart holds the " +
        "approved product at the approved price before it pays, and it is where the default " +
        "spend ceiling comes from."
    ),
  max_price: z
    .string()
    .optional()
    .describe(
      'The MOST Lane may spend, as a decimal string ("49.99"). Optional when `line` is ' +
        "given — it then defaults to the quoted unit price x quantity plus headroom for " +
        "shipping and tax. Supply it to set your own ceiling."
    ),
  price_headroom: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe(
      "How much above the quoted item total the order may go, as a fraction, to cover " +
        "shipping and tax. Defaults to 0.25. Ignored when max_price is given."
    ),
  ship_to: shipToSchema.describe("Where the order ships."),
  currency: z
    .string()
    .length(3)
    .optional()
    .describe("ISO currency. Defaults to USD."),
  quantity: z.number().int().min(1).optional().describe("Defaults to 1."),
  product: z
    .string()
    .optional()
    .describe("What is being bought, in words. Helps diagnosis."),
  dry_run: z
    .boolean()
    .optional()
    .describe(
      "Drive the whole checkout but REFUSE to place the order. A no-charge rehearsal; use it first."
    ),
};

export const laneCheckoutStatusInputSchema = {
  order_id: z
    .string()
    .min(1)
    .describe("The order_id returned by lane_checkout."),
  wait_seconds: z
    .number()
    .int()
    .min(0)
    .max(60)
    .optional()
    .describe(
      "Long-poll: return as soon as the status changes, or after this many seconds."
    ),
};

export type LaneCheckoutArgs = {
  payment_url: string;
  endpoint_url: string;
  max_price?: string;
  price_headroom?: number;
  line?: z.infer<typeof lineSchema>;
  ship_to: z.infer<typeof shipToSchema>;
  currency?: string;
  quantity?: number;
  product?: string;
  dry_run?: boolean;
};

/** Shipping and tax are not in a UCP cart quote. See `derivedCeiling`. */
const DEFAULT_HEADROOM = 0.25;

export type LaneCheckoutStatusArgs = {
  order_id: string;
  wait_seconds?: number;
};

/** The merchant name the Order API requires. Derived from the UCP endpoint host
 *  because that is the one thing the caller must already have right. */
function merchantFrom(endpointUrl: string): string {
  return new URL(endpointUrl).host.replace(/^www\./, "");
}

async function answering<T>(
  work: () => Promise<T>
): Promise<T | { error: string }> {
  try {
    return await work();
  } catch (e) {
    if (e instanceof LaneApiError) return { error: e.message };
    if (e instanceof Error && e.name === "TimeoutError") {
      return { error: "Lane did not accept the order in time" };
    }
    throw e;
  }
}

export const LANE_TOOLS = [
  {
    name: "lane_checkout",
    description:
      "Place a real order at a merchant, paying with a Lane card, using a payment_url from " +
      "ucp_get_payment_url. Lane builds an intent, drives a browser through the merchant's own " +
      "checkout, fills the card and confirms the result. This tool STARTS that run and returns " +
      "immediately with an order_id; poll lane_checkout_status for the outcome. " +
      "THIS SPENDS MONEY. max_price is the binding ceiling; pass `line` (the catalog title, " +
      "variant and unit price) and it defaults to the quoted item total plus headroom for " +
      "shipping and tax — and, more importantly, lets Lane verify the cart holds the " +
      "approved product at the approved price before it pays. Pass dry_run: true first to " +
      "drive the entire checkout without placing the order. " +
      "Requires a Lane account on a Business plan; a caller without one gets order_api_forbidden. " +
      "On a shared Lane deployment the order is placed against the deployment's configured Lane " +
      "account, not a per-caller one.",
    schema: z.object(laneCheckoutInputSchema),
    run: (args: LaneCheckoutArgs, deps: LaneDeps, bearer: string) =>
      answering(async () => {
        const quantity = args.quantity ?? 1;
        const currency = args.currency ?? args.line?.currency ?? "USD";
        const ceiling =
          args.max_price ??
          (args.line
            ? derivedCeiling(
                args.line.unit_price,
                quantity,
                args.price_headroom ?? DEFAULT_HEADROOM
              )
            : null);
        // A CEILING IS NOT OPTIONAL, it is only DERIVABLE. Lane's budget check
        // fails open with no budget, so an order without one is unbounded —
        // refuse here rather than send it.
        if (!ceiling) {
          throw new LaneApiError(
            "no spend ceiling: pass max_price, or pass `line` so it can be derived from " +
              "the quoted unit price"
          );
        }
        return createOrder(
          deps.baseUrl ?? DEFAULT_BASE,
          bearer,
          {
            product_url: args.payment_url,
            ...(args.product === undefined ? {} : { product: args.product }),
            max_price: ceiling,
            currency,
            merchant: merchantFrom(args.endpoint_url),
            quantity,
            ship_to: args.ship_to,
            ...(args.line
              ? {
                  ucp_line: {
                    variant_id: args.line.variant_id,
                    title: args.line.title,
                    unit_price: args.line.unit_price,
                    currency: args.line.currency ?? currency,
                  },
                }
              : {}),
            ...(args.dry_run === undefined ? {} : { dry_run: args.dry_run }),
            metadata: { source: "ucp-index-mcp" },
          },
          deps
        );
      }),
  },
  {
    name: "lane_checkout_status",
    description:
      "The outcome of a lane_checkout order: status, the amount actually charged, the " +
      "merchant's order number, tracking, and — when it failed — the reason, stage and " +
      "category. Pass wait_seconds to block until the status changes rather than polling.",
    schema: z.object(laneCheckoutStatusInputSchema),
    run: (args: LaneCheckoutStatusArgs, deps: LaneDeps, bearer: string) =>
      answering(() =>
        getOrder(
          deps.baseUrl ?? DEFAULT_BASE,
          bearer,
          args.order_id,
          deps,
          args.wait_seconds
        )
      ),
  },
] as const;
