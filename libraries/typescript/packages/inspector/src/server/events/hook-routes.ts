/**
 * Inspector server routes for the MCP Events inbox (§10.5, D33, D71).
 *
 * - `POST {base}/inspector/api/events/inboxes`: create (same-origin + dev token)
 * - `GET  …/inboxes/:id/stream?after=<seq>`: SSE (read token)
 * - `PATCH …/inboxes/:id`: rotate secret, fault preset, profile (read token)
 * - `DELETE …/inboxes/:id`: remove (read token)
 * - `POST {base}/inspector/api/events/hooks/:id`: public, HMAC-verified
 */
import type { Context, Hono } from "hono";
import { MAX_ENVELOPE_BYTES } from "@mcp-use/events-core";
import {
  InboxLimitError,
  type InboxPatch,
  type InboxProfile,
  type FaultPreset,
  type StorageEventsInbox,
} from "./inbox-store.js";
import { inboxSseResponse } from "./sse.js";

/** Options for {@link mountEventsInboxRoutes}. */
export interface EventsInboxRoutesOptions {
  /** Mount prefix, e.g. `""` or the app's base path. */
  basePath?: string;
  /** The inbox, or a promise of it (opened from the environment). */
  inbox: StorageEventsInbox | Promise<StorageEventsInbox>;
  /**
   * Public origin hooks are addressed to (a tunnel or hosted origin). Default:
   * the origin of the create request.
   */
  publicOrigin?: string;
  /** Dev token required on create when present (`mcp-use dev`). */
  devToken?: string;
  /** Extra origins allowed to create inboxes besides same-origin. */
  allowedOrigins?: readonly string[];
}

const PROFILES: readonly InboxProfile[] = ["auto", "sep-3415", "openai"];
const FAULTS: readonly FaultPreset["type"][] = [
  "status-500",
  "status-410",
  "status-413",
  "redirect-307",
  "timeout",
  "slow-ack",
  "pending-503",
  "bad-challenge",
  "echo-body",
];

function requestOrigin(c: Context): string {
  const url = new URL(c.req.url);
  const host =
    c.req.header("x-forwarded-host")?.split(",")[0]?.trim() ||
    c.req.header("host") ||
    url.host;
  const proto =
    c.req.header("x-forwarded-proto")?.split(",")[0]?.trim() ||
    url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

function sameOrigin(c: Context, allowed: readonly string[]): boolean {
  const origin = c.req.header("origin");
  // Non-browser callers send no Origin; browsers always do on a POST.
  if (!origin) return c.req.header("sec-fetch-site") === undefined;
  try {
    const normalized = new URL(origin).origin;
    return normalized === requestOrigin(c) || allowed.includes(normalized);
  } catch {
    return false;
  }
}

function bearer(c: Context): string | undefined {
  const auth = c.req.header("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  // EventSource cannot set headers, so the stream also takes `?token=`.
  return c.req.query("token") ?? undefined;
}

function parseFault(value: unknown): FaultPreset | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  if (!FAULTS.includes(v.type as FaultPreset["type"])) return undefined;
  const fault: FaultPreset = { type: v.type as FaultPreset["type"] };
  if (Number.isInteger(v.remaining) && (v.remaining as number) > 0) {
    fault.remaining = v.remaining as number;
  }
  if (Number.isInteger(v.delayMs) && (v.delayMs as number) >= 0) {
    fault.delayMs = Math.min(v.delayMs as number, 120_000);
  }
  return fault;
}

async function readCapped(
  request: Request,
  maxBytes: number
): Promise<{ body?: Uint8Array; size: number }> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await request.body?.cancel().catch(() => undefined);
    return { size: declared };
  }
  if (!request.body) return { body: new Uint8Array(0), size: 0 };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { size };
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { body, size };
}

/**
 * Mounts the Events inbox routes on a Hono app. Every Inspector host calls
 * this through `registerInspectorProxyRoutes`.
 *
 * @param app - The Hono app.
 * @param options - Base path, inbox and access options.
 */
export function mountEventsInboxRoutes(
  app: Hono,
  options: EventsInboxRoutesOptions
): void {
  const base = `${options.basePath ?? ""}/inspector/api/events`;
  const allowed = options.allowedOrigins ?? [];
  const inboxReady = Promise.resolve(options.inbox);
  // An unopenable store must not crash the host at import; routes answer 503.
  inboxReady.catch((error) =>
    console.error("[Inspector] Events inbox unavailable:", error)
  );
  const getInbox = async (c: Context) => {
    try {
      return await inboxReady;
    } catch {
      c.status(503);
      return undefined;
    }
  };

  app.post(`${base}/inboxes`, async (c) => {
    if (!sameOrigin(c, allowed)) {
      return c.json(
        { error: "cross-origin inbox creation is not allowed" },
        403
      );
    }
    if (
      options.devToken &&
      c.req.header("x-mcp-use-dev-token") !== options.devToken
    ) {
      return c.json({ error: "dev token required" }, 401);
    }
    const inbox = await getInbox(c);
    if (!inbox) return c.json({ error: "inbox store unavailable" }, 503);
    let profile: InboxProfile = "auto";
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        profile?: string;
      };
      if (body.profile && PROFILES.includes(body.profile as InboxProfile)) {
        profile = body.profile as InboxProfile;
      }
    } catch {
      // empty body is fine
    }
    try {
      const created = await inbox.create(profile);
      const origin = (options.publicOrigin ?? requestOrigin(c)).replace(
        /\/$/,
        ""
      );
      return c.json(
        {
          ...created,
          callbackUrl: `${origin}${base}/hooks/${created.inboxId}`,
        },
        201
      );
    } catch (error) {
      if (error instanceof InboxLimitError) {
        return c.json({ error: error.message }, 429);
      }
      throw error;
    }
  });

  app.get(`${base}/inboxes/:id/stream`, async (c) => {
    const inbox = await getInbox(c);
    if (!inbox) return c.json({ error: "inbox store unavailable" }, 503);
    const id = c.req.param("id");
    if (!(await inbox.authorize(id, bearer(c)))) {
      return c.json({ error: "unknown inbox or bad read token" }, 404);
    }
    const raw = c.req.query("after") ?? c.req.header("last-event-id");
    const after = raw && /^\d+$/.test(raw) ? Number(raw) : null;
    return inboxSseResponse(inbox, id, { after, signal: c.req.raw.signal });
  });

  app.patch(`${base}/inboxes/:id`, async (c) => {
    const inbox = await getInbox(c);
    if (!inbox) return c.json({ error: "inbox store unavailable" }, 503);
    const id = c.req.param("id");
    if (!(await inbox.authorize(id, bearer(c)))) {
      return c.json({ error: "unknown inbox or bad read token" }, 404);
    }
    const body = (await c.req.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) return c.json({ error: "JSON body required" }, 400);
    const patch: InboxPatch = {};
    if (body.rotateSecret === true) patch.rotateSecret = true;
    if ("fault" in body) {
      const fault = parseFault(body.fault);
      if (fault === undefined) return c.json({ error: "invalid fault" }, 400);
      patch.fault = fault;
    }
    if ("profile" in body) {
      if (!PROFILES.includes(body.profile as InboxProfile)) {
        return c.json({ error: "invalid profile" }, 400);
      }
      patch.profile = body.profile as InboxProfile;
    }
    const updated = await inbox.update(id, patch);
    return updated ? c.json(updated) : c.json({ error: "unknown inbox" }, 404);
  });

  app.delete(`${base}/inboxes/:id`, async (c) => {
    const inbox = await getInbox(c);
    if (!inbox) return c.json({ error: "inbox store unavailable" }, 503);
    const id = c.req.param("id");
    if (!(await inbox.authorize(id, bearer(c)))) {
      return c.json({ error: "unknown inbox or bad read token" }, 404);
    }
    await inbox.delete(id);
    return c.body(null, 204);
  });

  app.post(`${base}/hooks/:id`, async (c) => {
    const inbox = await getInbox(c);
    if (!inbox) return c.json({ error: "inbox store unavailable" }, 503);
    if (c.req.raw.bodyUsed) {
      // A body parser ran before this route (Express `express.json()`), so
      // the raw bytes the signature covers are gone. Say so instead of
      // reporting a bogus signature failure.
      return c.json(
        {
          error:
            "the request body was consumed before the Inspector inbox could read it; mount the Inspector before any body-parsing middleware",
        },
        500
      );
    }
    const { body, size } = await readCapped(c.req.raw, MAX_ENVELOPE_BYTES);
    const result = await inbox.receive(
      c.req.param("id"),
      c.req.raw.headers,
      body,
      size
    );
    for (const [k, v] of Object.entries(result.headers ?? {})) c.header(k, v);
    if (result.body === undefined) {
      return c.body(null, result.status as 200);
    }
    return c.json(result.body, result.status as 200);
  });
}
