/**
 * MCP Events webhook inbox for the Events tab: in-memory inboxes, each with
 * its own `whsec_` secret, that verify deliveries, answer the verification
 * challenge and keep the most recent deliveries for the UI.
 */
import type { Hono, MiddlewareHandler } from "hono";

// Loaded on first use: this module is reachable from vite.config.ts (via the
// dev API plugin), and tools such as knip load that config before
// @mcp-use/client is built, when its "./events" export has no dist yet.
const loadEvents = () => import("@mcp-use/client/events");

const MAX_INBOXES = 50;
const MAX_DELIVERIES = 200;
const MAX_BODY = 256 * 1024;

/** One received POST. */
interface InboxDelivery {
  receivedAt: string;
  webhookId: string | null;
  subscriptionId: string | null;
  verified: boolean;
  /** `verification` for a challenge, `event` otherwise. */
  kind: "verification" | "event";
  /** Webhook-relevant request headers (signature and ids). */
  headers: Record<string, string>;
  body: unknown;
}

const KEPT_HEADERS = [
  "content-type",
  "webhook-id",
  "webhook-timestamp",
  "webhook-signature",
  "x-mcp-subscription-id",
  "user-agent",
];

interface Inbox {
  secret: string;
  deliveries: InboxDelivery[];
}

/**
 * Mount `POST {base}/inspector/api/events/inboxes` (create),
 * `GET .../inboxes/:id` (deliveries) and `POST .../hooks/:id` (the callback).
 *
 * @param app - The Inspector Hono app.
 * @param basePath - Prefix the Inspector is mounted under.
 * @param rateLimit - Optional middleware applied to every inbox route.
 */
export function mountEventsInbox(
  app: Hono,
  basePath = "",
  rateLimit?: MiddlewareHandler
): void {
  const inboxes = new Map<string, Inbox>();
  const root = `${basePath}/inspector/api/events`;
  if (rateLimit) app.use(`${root}/*`, rateLimit);

  app.post(`${root}/inboxes`, async (c) => {
    if (inboxes.size >= MAX_INBOXES) {
      inboxes.delete(inboxes.keys().next().value as string);
    }
    const id = crypto.randomUUID();
    const secret = (await loadEvents()).generateWebhookSecret();
    inboxes.set(id, { secret, deliveries: [] });
    return c.json({ id, secret, path: `${root}/hooks/${id}` });
  });

  app.get(`${root}/inboxes/:id`, (c) => {
    const inbox = inboxes.get(c.req.param("id"));
    if (inbox === undefined) return c.json({ error: "not found" }, 404);
    return c.json({ deliveries: inbox.deliveries });
  });

  app.post(`${root}/hooks/:id`, async (c) => {
    const inbox = inboxes.get(c.req.param("id"));
    if (inbox === undefined) return c.json({ error: "not found" }, 410);
    // Reject a declared oversize body before buffering it.
    if (Number(c.req.header("content-length") ?? 0) > MAX_BODY)
      return c.json({ error: "too large" }, 413);
    const text = await c.req.text();
    if (text.length > MAX_BODY) return c.json({ error: "too large" }, 413);
    const headers = c.req.raw.headers;
    const { verifyWebhookSignature } = await loadEvents();
    const verified = await verifyWebhookSignature(
      [inbox.secret],
      headers,
      text
    );
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    const type = (body as { type?: unknown } | null)?.type;
    inbox.deliveries.unshift({
      receivedAt: new Date().toISOString(),
      webhookId: headers.get("webhook-id"),
      subscriptionId: headers.get("x-mcp-subscription-id"),
      verified,
      kind: type === "verification" ? "verification" : "event",
      headers: Object.fromEntries(
        KEPT_HEADERS.flatMap((h) => {
          const v = headers.get(h);
          return v === null ? [] : [[h, v]];
        })
      ),
      body,
    });
    inbox.deliveries.length = Math.min(inbox.deliveries.length, MAX_DELIVERIES);
    if (!verified) return c.json({ error: "invalid signature" }, 401);
    if (type === "verification") {
      return c.json({
        challenge: (body as { challenge?: unknown }).challenge,
      });
    }
    return c.json({});
  });
}
