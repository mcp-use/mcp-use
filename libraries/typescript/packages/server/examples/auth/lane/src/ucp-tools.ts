/**
 * The five UCP tools, as an agent sees them.
 *
 * THE SHAPE IS THE FLOW: find who sells it, browse what they carry, get a URL
 * that opens a checkout. Each description says which tool to reach for next,
 * because the failure mode here is not a broken call -- it is an agent picking
 * the wrong one of several superficially similar paths and concluding UCP does
 * not work:
 *
 *   ucp_search_products  → `checkout_url`, a SHOPIFY EXTENSION on an aggregator
 *   ucp_get_payment_url  → `continue_url`, the SPEC's own handoff URL
 *
 * The second is the durable one and the descriptions say so. The first is kept
 * because it finds products across sellers in one call, which the spec path
 * cannot do -- it needs a merchant and a variant before it can ask anything.
 *
 * THREE TOOLS NOW RETURN PRODUCTS, which makes that failure mode worse rather
 * than better, so each one names its siblings and `server.test.ts` asserts that
 * it does. The one that ends in a spec-native checkout is:
 *
 *   ucp_find_product → `variant_id` → ucp_get_payment_url → `continue_url`
 *
 * and it is the only product tool whose rows are confirmed against the seller
 * before an agent sees them, because Lane's index holds crawled titles that
 * nothing re-crawls yet.
 *
 * NOTHING HERE BUYS ANYTHING, and the boundary moved by exactly one method:
 * `ucp_get_payment_url` calls `create_checkout`, which opens a session and moves
 * no money. `complete_checkout` is on the other side of that line and is not
 * reachable from this surface. See the boundary note in ucp.ts.
 */
import { z } from "zod";
import {
  browseMerchant,
  findMerchants,
  findProduct,
  getPaymentUrl,
  reportEvent,
  searchProducts,
  UcpError,
  type UcpDeps,
} from "./ucp.js";

export const findMerchantsInputSchema = {
  query: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'What the merchant sells, e.g. "running shoes" or "espresso beans".'
    ),
  // 100 BECAUSE THAT IS THE INDEX'S OWN CEILING (`limit: Query(20, ge=1,
  // le=100)` on `/merchants`). It was 50, which is not a second opinion about a
  // safe page size -- it is a cap no caller could see, on a surface whose whole
  // job is to enumerate merchants, so half the available page was unreachable
  // through this tool and reachable with curl.
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe(
      "Max merchants to return. Defaults to 10; the index caps at 100."
    ),
  hostname: z
    .string()
    .max(253)
    .optional()
    .describe(
      "Look up ONE merchant by hostname instead of searching. Overrides query."
    ),
  prefer_category: z
    .array(z.string())
    .max(4)
    .optional()
    .describe(
      "What KIND of thing this is, from: apparel, footwear, jewelry, beauty, health, supplements, food, beverage, alcohol, home, furniture, garden, kitchen, pets, baby, toys, sports, outdoors, automotive, electronics, computing, phones, audio, photography, books, media, music, art, crafts, office, industrial, tools, building, agriculture, medical, cannabis, firearms, travel, tickets, services, software, subscriptions, gifts, other. " +
        'Supply it whenever you can work it out — for a brand you know ("dyson" is home), ' +
        "for a product noun, for anything. Merchants in that category rank higher; nothing " +
        "is excluded, so a wrong guess costs little and a right one is worth a lot. " +
        "Measured: merchants matching the category stock the thing 92.6% of the time " +
        "against 52.5% for those that do not."
    ),
  execution: z
    .enum(["mcp", "api", "any"])
    .optional()
    .describe(
      "Which merchants to return. 'mcp' (the default) keeps to merchants the sibling " +
        "tools can actually drive; 'any' includes REST-only rows nothing here can browse " +
        "or check out. Ignored for a hostname lookup unless you set it. " +
        "excluded_execution reports what the filter hid, but ONLY when the search came " +
        "back empty — a page with some results does not say what it left out, so use " +
        "execution='any' when you want to be sure you are seeing everything."
    ),
};

export const searchProductsInputSchema = {
  query: z
    .string()
    .min(1)
    .max(200)
    .describe('What to buy, e.g. "asics superblast 3 mens 10".'),
  country: z
    .string()
    .length(2)
    .optional()
    .describe("ISO country the order must ship to. Defaults to US."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(25)
    .optional()
    .describe("Max products. Defaults to 10."),
};

export const findProductInputSchema = {
  query: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'The product, named as specifically as you can, e.g. "nalgene 32 oz wide mouth".'
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(25)
    .optional()
    .describe("Max sellers to return. Defaults to 10."),
  confirm: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe(
      "How many candidate sellers to ask for a live price. Defaults to 5. Each one is a " +
        "separate request to a merchant, so a higher number costs seconds, not milliseconds."
    ),
};

export const browseMerchantInputSchema = {
  endpoint_url: z
    .string()
    .url()
    .describe(
      "The merchant's UCP MCP endpoint, as returned by ucp_find_merchants."
    ),
  query: z.string().min(1).max(200).describe("What to look for in this store."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(25)
    .optional()
    .describe("Max products. Defaults to 10."),
};

export const getPaymentUrlInputSchema = {
  endpoint_url: z
    .string()
    .url()
    .describe("The merchant's own UCP MCP endpoint, from ucp_find_merchants."),
  variant_id: z
    .string()
    .min(1)
    .max(200)
    .describe(
      "The variant to buy, in the merchant's own id space (e.g. gid://shopify/ProductVariant/123)."
    ),
  quantity: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("Defaults to 1."),
  method: z
    .enum(["cart", "checkout"])
    .optional()
    .describe(
      "How to obtain it. 'cart' (default) is measured at 41/41 and returns no status to " +
        "interpret. 'checkout' additionally returns the spec status, the merchant's " +
        "diagnostic messages, and the payment handlers it accepts — ask for it when you " +
        "want to know WHY rather than WHERE."
    ),
  country: z
    .string()
    .length(2)
    .optional()
    .describe("ISO country for the cart context. Defaults to US."),
  currency: z
    .string()
    .length(3)
    .optional()
    .describe("ISO currency for the cart context. Defaults to USD."),
};

export type GetPaymentUrlArgs = {
  endpoint_url: string;
  variant_id: string;
  quantity?: number;
  method?: "cart" | "checkout";
  country?: string;
  currency?: string;
};

export type FindMerchantsArgs = {
  query: string;
  limit?: number;
  hostname?: string;
  prefer_category?: string[];
  execution?: "mcp" | "api" | "any";
};
export type SearchProductsArgs = {
  query: string;
  country?: string;
  limit?: number;
};
export type FindProductArgs = {
  query: string;
  limit?: number;
  confirm?: number;
};
export type BrowseMerchantArgs = {
  endpoint_url: string;
  query: string;
  limit?: number;
};

/**
 * A refusal is an ANSWER, not a crash.
 *
 * A UCP endpoint refuses for specific, actionable reasons -- an ineligible
 * shipping country, a catalog that is not enabled, a profile it could not
 * fetch. Letting those throw turns every one of them into "the server is
 * broken" in a client, so they come back as a result carrying the merchant's own
 * sentence. Anything that is NOT a UcpError is a real defect here and is left to
 * throw.
 */
async function answering<T>(
  work: () => Promise<T>
): Promise<T | { error: string }> {
  try {
    return await work();
  } catch (e) {
    if (e instanceof UcpError) return { error: e.message };
    if (e instanceof Error && e.name === "TimeoutError") {
      return { error: "the merchant catalog did not respond in time" };
    }
    throw e;
  }
}

export const UCP_TOOLS = [
  {
    name: "ucp_find_merchants",
    description:
      "Find UCP-enabled merchants by what they sell, from Lane's index of ~18,600 " +
      "merchant profiles. Returns each one's hostname, brand, what it sells, and " +
      "its UCP endpoint_url — pass that to ucp_browse_merchant to see its catalog. " +
      'This answers "WHO sells this"; use ucp_search_products when you want to buy ' +
      "something and need a checkout link. " +
      "When all_terms_count is 0, no merchant anywhere matched the entire query: " +
      "merchants then holds only brand-verified rows (often none), and the rest " +
      "arrive under partial_matches — context for reformulating, not answers. " +
      "Each result also carries all_terms for the same signal per row.",
    schema: z.object(findMerchantsInputSchema),
    // The whole object, not just its rows: `all_terms_count` is the field an
    // agent should branch on and it does not live on any single merchant.
    run: (args: FindMerchantsArgs, deps: UcpDeps) =>
      answering(async () => {
        const found = await findMerchants(
          args.query,
          {
            ...(args.limit === undefined ? {} : { limit: args.limit }),
            ...(args.hostname === undefined ? {} : { hostname: args.hostname }),
            ...(args.prefer_category === undefined
              ? {}
              : { preferCategory: args.prefer_category }),
            // THE DEFAULT LIVES HERE, not on the index. `/merchants` deliberately
            // has none -- about 7% of the corpus is `api` and hiding it from every
            // consumer would make the index dishonest about what it holds. This
            // tool's three siblings can drive nothing but MCP.
            //
            // NOT ON A LOOKUP. A hostname lookup carries an identifier and asks
            // one question: do you hold this merchant. The index applies the
            // execution filter to lookups too, so defaulting it here answered
            // `merchants: []` for a merchant the corpus DOES hold, purely because
            // it speaks REST. An explicit `execution` is still honoured.
            ...(args.hostname !== undefined && args.execution === undefined
              ? {}
              : { execution: args.execution ?? "mcp" }),
          },
          deps
        );
        if (found.all_terms_count !== 0) return found;
        // Nothing anywhere matched the whole query. The split is what makes
        // that unmissable: a brand-verified row keeps its place, the rest are
        // handed over as context rather than as answers.
        //
        // `excluded_execution` RIDES ALONG, and forgetting it was a real bug:
        // the index populates that field ONLY when the filtered search returned
        // nothing, and an empty page is exactly what makes all_terms_count 0 --
        // so the hand-built object below dropped the field in the one case it
        // is ever set. The mitigation for the default was unreachable on every
        // query search.
        return {
          merchants: found.merchants.filter((m) => m.brand_promoted),
          all_terms_count: 0,
          partial_matches: found.merchants.filter((m) => !m.brand_promoted),
          excluded_execution: found.excluded_execution,
          partial_note:
            "No merchant matched every term of the query. These matched only part " +
            "of it — do not present them as carrying what was asked for." +
            (found.excluded_execution
              ? " The execution filter also hid merchants: see excluded_execution, " +
                'and retry with execution="any" to see them.'
              : ""),
        };
      }),
  },
  {
    name: "ucp_search_products",
    description:
      "Search Shopify's cross-seller UCP catalog and return products WITH A " +
      "CHECKOUT LINK. Each result carries checkout_url: a prefilled hosted " +
      "checkout for that exact variant, supplied by the seller. This is the tool " +
      "to use when the goal is to buy something and ONE call is enough. It does " +
      "NOT place an order — opening and completing that checkout is a separate, " +
      "deliberate step. " +
      "It sees only merchants inside Shopify's aggregator, and it does not check " +
      "that a seller still carries the item. For wider coverage and a live, " +
      "confirmed price per seller, use ucp_find_product. To search one store you " +
      "already know, use ucp_browse_merchant.",
    schema: z.object(searchProductsInputSchema),
    run: (args: SearchProductsArgs, deps: UcpDeps) =>
      answering(async () => ({
        products: await searchProducts(
          args.query,
          {
            ...(args.country === undefined ? {} : { country: args.country }),
            ...(args.limit === undefined ? {} : { limit: args.limit }),
          },
          deps
        ),
      })),
  },
  {
    name: "ucp_find_product",
    description:
      "Find ONE SPECIFIC PRODUCT across every merchant Lane has crawled — 16,488 " +
      "catalogs, 32 million product titles — and return each seller with a LIVE " +
      "price, availability and variant_id. Pass that variant_id straight to " +
      "ucp_get_payment_url for a checkout link; it is already in the form that " +
      "tool needs. Verified end to end against live merchants. " +
      "WHICH OF THE THREE PRODUCT TOOLS TO USE. This one when you know WHAT you " +
      "want and need to compare sellers — it is the only one that sees merchants " +
      "outside Shopify's aggregator, and the only one that confirms every row " +
      "against the seller before showing it. ucp_search_products when one call is " +
      "enough and you want the aggregator's own prefilled checkout_url. " +
      "ucp_browse_merchant when you already know the store. " +
      "READ `strict` AND `capped` BEFORE TRUSTING THE RESULTS. strict=false means " +
      "NOTHING matched your whole query and the index answered a relaxed version " +
      "of it — say so rather than presenting the rows as the item you asked for. " +
      "capped=true means the query was broad enough that these sellers are a " +
      "sample rather than the best ones; name the product more precisely. " +
      "`unconfirmed` counts sellers the index listed whose live catalog did not " +
      "return the product; they are already removed, so a low count is not a " +
      "problem. SLOWER THAN THE OTHER TWO — it asks each seller for a live price. " +
      "It places no order.",
    schema: z.object(findProductInputSchema),
    run: (args: FindProductArgs, deps: UcpDeps) =>
      answering(() =>
        findProduct(
          args.query,
          {
            ...(args.limit === undefined ? {} : { limit: args.limit }),
            ...(args.confirm === undefined ? {} : { confirm: args.confirm }),
          },
          deps
        )
      ),
  },
  {
    name: "ucp_browse_merchant",
    description:
      "Search ONE merchant's own UCP catalog, given the endpoint_url from " +
      "ucp_find_merchants. Use it to see what a specific store carries. " +
      "IMPORTANT: a per-merchant endpoint does not supply checkout links, so " +
      "checkout_url is null on every row here — that is the endpoint's " +
      "behaviour, not an error. For a link, search the same item with " +
      "ucp_search_products. To find WHICH store carries a product in the first " +
      "place, use ucp_find_product.",
    schema: z.object(browseMerchantInputSchema),
    run: (args: BrowseMerchantArgs, deps: UcpDeps) =>
      answering(async () => {
        const products = await browseMerchant(
          args.endpoint_url,
          args.query,
          {
            ...(args.limit === undefined ? {} : { limit: args.limit }),
          },
          deps
        );
        // AFTER, AND ONLY ON SUCCESS. Reported first, this fired on a hostname
        // taken straight from a tool argument before anything verified it --
        // so any caller could have Lane's own server relay an authenticated
        // follow-up for a merchant it never touched. The label is supposed to
        // mean "an agent went and looked", so it waits until one did.
        reportEvent("browse", args.endpoint_url, deps);
        return {
          products,
          note: "Per-merchant endpoints do not return checkout links. Use ucp_search_products for one.",
        };
      }),
  },
  {
    name: "ucp_get_payment_url",
    description:
      "Get a payment URL for a specific variant from the MERCHANT'S OWN UCP " +
      "endpoint, using the protocol's own checkout method. Returns " +
      "payment_url (the spec's continue_url), status, checkout_id, expires_at, " +
      "totals, and the merchant's messages saying what is still missing. " +
      "PREFER THIS over the checkout_url from ucp_search_products: that field is " +
      "a Shopify extension on an aggregator endpoint and appears nowhere in the " +
      "UCP spec, whereas continue_url is spec-defined. Measured at 41/41 on " +
      "merchants whose index row says execution=mcp. Works on any UCP merchant, " +
      "not just Shopify. It opens a cart or checkout session and moves NO money " +
      "— always check `usable` before trusting the URL, because an out-of-stock " +
      "item still returns one, pointing at the storefront root. Open the URL in " +
      "a browser or any cookie-capable client: fetched without cookies it " +
      "redirects to the shop home page and returns 200, which looks like " +
      "success and is not.",
    schema: z.object(getPaymentUrlInputSchema),
    run: (args: GetPaymentUrlArgs, deps: UcpDeps) =>
      answering(async () => {
        const got = await getPaymentUrl(
          args.endpoint_url,
          args.variant_id,
          {
            ...(args.quantity === undefined ? {} : { quantity: args.quantity }),
            ...(args.method === undefined ? {} : { method: args.method }),
            ...(args.country === undefined ? {} : { country: args.country }),
            ...(args.currency === undefined ? {} : { currency: args.currency }),
          },
          deps
        );
        reportEvent("payment_url", args.endpoint_url, deps);
        return got;
      }),
  },
] as const;
