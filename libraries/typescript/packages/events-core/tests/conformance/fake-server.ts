/**
 * A scripted raw-HTTP Events server for the conformance tests. It is correct
 * for both profiles by default; each named fault breaks it in exactly one way
 * so a check can be shown to fail when it should.
 */
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import {
  checkParamHeaders,
  EVENTS_ERROR_CODES,
  EVENTS_EXTENSION_ID,
  generateWebhookId,
  HEADER_MISMATCH_CODE,
  parseWebhookSecret,
  readMcpNameHeader,
  signWebhook,
  SUBSCRIPTION_ID_META_KEY,
} from "../../src/index.js";

export type Fault =
  | "cap-top-missing"
  | "cap-ext-missing"
  | "ext-on-legacy"
  | "list-no-payload-schema"
  | "openai-all-modes"
  | "short-description"
  | "list-signed-out-empty"
  | "sub-auth-open"
  | "verify-unsigned"
  | "event-before-verify"
  | "id-random"
  | "reverify"
  | "ttl-long"
  | "codes-wrong"
  | "callback-error-accepted"
  | "uns-wrong"
  | "nonreplay-truncated"
  | "webhook-id-wrong"
  | "del-type"
  | "hdr-name-mismatch-accepted"
  | "hdr-name-missing-accepted"
  | "hdr-param-accepted"
  | "poll-null-events"
  | "poll-no-advance"
  | "poll-ignore-max"
  | "poll-stale-error"
  | "nextpoll-small"
  | "poll-event-cursor"
  | "payload-bad"
  | "stream-heartbeat-first"
  | "stream-meta-wrong"
  | "heartbeat-no-cursor"
  | "stream-silent"
  | "stream-open-then-error"
  | "cursor-inconsistent";

type Profile = "openai" | "sep-3415";
const BEARER = "Bearer good-token";
const TICK_MS = 40;

interface Sub {
  id: string;
  url: string;
  secret: string;
  profile: Profile;
  sent: number;
}

export interface FakeServer {
  url: string;
  bearer: string;
  close(): Promise<void>;
}

export async function startFakeServer(
  faults: Fault[] = []
): Promise<FakeServer> {
  const f = new Set<Fault>(faults);
  const log: Array<{
    eventId: string;
    name: string;
    timestamp: string;
    data: unknown;
  }> = [];
  const sessions = new Map<string, Profile>();
  const subs = new Map<string, Sub>();
  const verified = new Set<string>();
  const streams = new Set<() => void>();

  const codes = (p: Profile) =>
    EVENTS_ERROR_CODES[p === "openai" ? "sketch" : "sep"];

  const descriptor = (p: Profile) => ({
    name: "tick",
    description: f.has("short-description")
      ? "Ticks."
      : "Fires on every tick of the fake clock; summarize the count for the user.",
    delivery:
      p === "openai" && !f.has("openai-all-modes")
        ? ["webhook"]
        : ["webhook", "push", "poll"],
    inputSchema: {
      type: "object",
      properties: { region: { type: "string", "x-mcp-header": "Region" } },
    },
    ...(f.has("list-no-payload-schema")
      ? {}
      : {
          payloadSchema: {
            type: "object",
            properties: { n: { type: "integer" } },
            required: ["n"],
          },
        }),
  });

  const deliver = async (
    s: Sub,
    body: Record<string, unknown>,
    webhookId: string,
    secret = s.secret
  ) => {
    const bytes = new TextEncoder().encode(JSON.stringify(body));
    const ts = Math.floor(Date.now() / 1000);
    const key = parseWebhookSecret(secret);
    const sig = await signWebhook(key ? [key] : [], webhookId, ts, bytes);
    return fetch(s.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "webhook-id": webhookId,
        "webhook-timestamp": String(ts),
        "webhook-signature": sig,
        "x-mcp-subscription-id": s.id,
      },
      body: bytes,
      redirect: "manual",
    });
  };

  const timer = setInterval(() => {
    const n = log.length;
    log.push({
      eventId: `ev_${n}`,
      name: "tick",
      timestamp: new Date().toISOString(),
      data: f.has("payload-bad") ? { n: "x" } : { n },
    });
    for (const s of subs.values()) {
      if (!verified.has(s.id)) continue;
      while (s.sent < log.length) {
        const ev = log[s.sent++]!;
        const body: Record<string, unknown> = {
          ...ev,
          cursor: s.profile === "openai" ? null : `c${s.sent}`,
        };
        if (f.has("del-type")) body.type = "event";
        const id =
          (s.profile === "openai") !== f.has("webhook-id-wrong")
            ? ev.eventId
            : generateWebhookId();
        void deliver(s, body, id).catch(() => undefined);
      }
    }
  }, TICK_MS);

  const send = (
    res: ServerResponse,
    status: number,
    body: unknown,
    headers: Record<string, string> = {}
  ) => {
    res
      .writeHead(status, { "content-type": "application/json", ...headers })
      .end(JSON.stringify(body));
  };

  const handle = async (
    req: IncomingMessage,
    res: ServerResponse,
    raw: string
  ) => {
    const msg = JSON.parse(raw) as {
      id?: string | number;
      method: string;
      params?: Record<string, any>;
    };
    const id = msg.id ?? null;
    const p = msg.params ?? {};
    const ok = (result: unknown, h?: Record<string, string>) =>
      send(res, 200, { jsonrpc: "2.0", id, result }, h);
    const err = (code: number, message: string, data?: unknown, status = 200) =>
      send(res, status, {
        jsonrpc: "2.0",
        id,
        error: { code, message, ...(data === undefined ? {} : { data }) },
      });

    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers))
      if (typeof v === "string") headers.set(k, v);
    const sid = headers.get("mcp-session-id");
    const meta = (p._meta ?? {}) as Record<string, any>;
    const clientName: string | undefined =
      meta["io.modelcontextprotocol/clientInfo"]?.name;
    const modern = headers.get("mcp-protocol-version") === "2026-07-28";
    const profile: Profile = modern
      ? clientName?.startsWith("openai-mcp")
        ? "openai"
        : "sep-3415"
      : ((sid ? sessions.get(sid) : undefined) ?? "openai");

    if (msg.method === "initialize") {
      const s = `s${sessions.size + 1}`;
      sessions.set(
        s,
        p.clientInfo?.name?.startsWith("openai-mcp") ? "openai" : "sep-3415"
      );
      return ok(
        {
          protocolVersion: "2025-11-25",
          capabilities: {
            tools: {},
            ...(f.has("cap-top-missing") ? {} : { events: {} }),
            ...(f.has("ext-on-legacy")
              ? { extensions: { [EVENTS_EXTENSION_ID]: {} } }
              : {}),
          },
          serverInfo: { name: "fake", version: "1" },
        },
        { "mcp-session-id": s }
      );
    }
    if (msg.method === "notifications/initialized")
      return void res.writeHead(202).end();
    if (msg.method === "server/discover") {
      return ok({
        resultType: "complete",
        supportedVersions: ["2026-07-28"],
        capabilities: {
          ...(f.has("cap-top-missing") ? {} : { events: {} }),
          ...(f.has("cap-ext-missing")
            ? {}
            : { extensions: { [EVENTS_EXTENSION_ID]: { listChanged: true } } }),
        },
      });
    }
    if (msg.method === "events/list") {
      const signedOut = headers.get("authorization") !== BEARER;
      if (signedOut && f.has("list-signed-out-empty"))
        return ok({ events: [] });
      return ok({ events: [descriptor(profile)] });
    }

    const named = [
      "events/subscribe",
      "events/unsubscribe",
      "events/poll",
      "events/stream",
    ];
    if (named.includes(msg.method) && profile === "sep-3415" && modern) {
      const name = readMcpNameHeader(headers);
      if (
        name !== undefined &&
        name !== p.name &&
        !f.has("hdr-name-mismatch-accepted")
      ) {
        return err(HEADER_MISMATCH_CODE, "HeaderMismatch", undefined, 400);
      }
      if (name === undefined && !f.has("hdr-name-missing-accepted")) {
        return err(HEADER_MISMATCH_CODE, "HeaderMismatch", undefined, 400);
      }
      if (p.name === "tick" && !f.has("hdr-param-accepted")) {
        const check = checkParamHeaders(
          descriptor(profile).inputSchema,
          p.arguments,
          headers
        );
        if (!check.ok)
          return err(HEADER_MISMATCH_CODE, "HeaderMismatch", undefined, 400);
      }
    }
    const c = codes(profile);
    if (named.includes(msg.method) && p.name !== "tick") {
      if (msg.method === "events/stream" && f.has("stream-open-then-error")) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(
          `data: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/events/active", params: { cursor: null, truncated: false, heartbeatMs: 1000, _meta: { [SUBSCRIPTION_ID_META_KEY]: id } } })}\n\n`
        );
        return res.end(
          `data: ${JSON.stringify({ jsonrpc: "2.0", id, error: { code: c.notFound, message: "NotFound" } })}\n\n`
        );
      }
      if (msg.method === "events/unsubscribe" && profile === "openai")
        return ok({});
      return err(f.has("codes-wrong") ? -32602 : c.notFound, "NotFound", {
        resource: "event",
      });
    }

    if (msg.method === "events/subscribe") {
      if (headers.get("authorization") !== BEARER && !f.has("sub-auth-open")) {
        return err(c.forbidden, "Forbidden");
      }
      const url: string = p.delivery.url;
      const subId = f.has("id-random")
        ? `sub_${Math.random().toString(36).slice(2).padEnd(22, "x").slice(0, 22)}`
        : `sub_${Buffer.from(`${p.name}|${url}`).toString("base64url").slice(-22).padStart(22, "A")}`;
      const existing = subs.get(url);
      const s: Sub = existing ?? {
        id: subId,
        url,
        secret: p.delivery.secret,
        profile,
        sent: log.length,
      };
      if (!existing || f.has("reverify")) {
        if (f.has("event-before-verify")) {
          await deliver(
            s,
            { ...log[log.length - 1], cursor: null },
            "msg_early"
          ).catch(() => undefined);
        }
        const challenge = `ch_${Math.random().toString(36).slice(2)}`;
        let echoed = false;
        try {
          const r = await deliver(
            s,
            { type: "verification", challenge },
            generateWebhookId("verification"),
            f.has("verify-unsigned")
              ? "whsec_" + Buffer.alloc(32, 7).toString("base64")
              : s.secret
          );
          echoed =
            r.ok &&
            ((await r.json().catch(() => ({}))) as { challenge?: string })
              .challenge === challenge;
        } catch {
          echoed = false;
        }
        if (!echoed && !f.has("callback-error-accepted")) {
          return err(c.callbackEndpointError, "CallbackEndpointError", {
            reason: "challenge_failed",
          });
        }
        subs.set(url, s);
        verified.add(s.id);
      }
      const ttl: number | null | undefined = p.ttlMs;
      const grant =
        ttl === null
          ? null
          : Math.min(ttl ?? 86_400_000, 86_400_000) *
            (f.has("ttl-long") ? 2 : 1);
      const stale = typeof p.cursor === "string";
      return ok({
        id: f.has("id-random") ? subId : s.id,
        refreshBefore:
          grant === null ? null : new Date(Date.now() + grant).toISOString(),
        cursor: profile === "openai" ? null : `c${log.length}`,
        truncated:
          profile === "openai" ? stale && f.has("nonreplay-truncated") : stale,
      });
    }
    if (msg.method === "events/unsubscribe") {
      const url: string = p.delivery.url;
      if (subs.delete(url) || profile === "openai" || f.has("uns-wrong"))
        return ok({});
      return err(c.notFound, "NotFound", { resource: "subscription" });
    }
    if (msg.method === "events/poll") {
      const head = log.length;
      const nextPollMs = f.has("nextpoll-small") ? 50 : 1000;
      const strip = (e: (typeof log)[number], i: number) =>
        f.has("poll-event-cursor") ? { ...e, cursor: `c${i + 1}` } : e;
      if (p.cursor === null || p.cursor === undefined) {
        const events = f.has("poll-null-events")
          ? [
              {
                eventId: "ev_early",
                name: "tick",
                timestamp: new Date().toISOString(),
                data: { n: 0 },
              },
            ]
          : [];
        return ok({
          events,
          cursor: f.has("cursor-inconsistent") ? null : `c${head}`,
          truncated: false,
          hasMore: false,
          nextPollMs,
        });
      }
      const m = /^c(\d+)$/.exec(String(p.cursor));
      if (!m) {
        if (f.has("poll-stale-error")) return err(-32602, "InvalidParams");
        return ok({
          events: [],
          cursor: `c${head}`,
          truncated: true,
          hasMore: false,
          nextPollMs,
        });
      }
      const from = Number(m[1]);
      const max = f.has("poll-ignore-max")
        ? 1000
        : Math.min(Number(p.maxEvents ?? 100), 100);
      const events = log
        .slice(from, from + max)
        .map((e, i) => strip(e, from + i));
      const to = from + events.length;
      return ok({
        events,
        cursor: f.has("poll-no-advance") ? `c${from}` : `c${to}`,
        truncated: false,
        hasMore: to < head,
        nextPollMs,
      });
    }
    if (msg.method === "events/stream") {
      const grant = Number(p.heartbeatMs ?? 1000);
      const metaId = f.has("stream-meta-wrong") ? "other" : id;
      res.writeHead(200, { "content-type": "text/event-stream" });
      const frame = (method: string, params: Record<string, unknown>) =>
        res.write(
          `data: ${JSON.stringify({ jsonrpc: "2.0", method, params: { ...params, _meta: { [SUBSCRIPTION_ID_META_KEY]: metaId } } })}\n\n`
        );
      let sent = log.length;
      const heartbeat = () =>
        frame(
          "notifications/events/heartbeat",
          f.has("heartbeat-no-cursor") ? {} : { cursor: `c${sent}` }
        );
      if (f.has("stream-heartbeat-first")) heartbeat();
      frame("notifications/events/active", {
        cursor: `c${sent}`,
        truncated: false,
        heartbeatMs: grant,
      });
      const ev = setInterval(() => {
        if (f.has("stream-silent")) return;
        while (sent < log.length) {
          const e = log[sent++]!;
          frame("notifications/events/event", { ...e, cursor: `c${sent}` });
        }
      }, TICK_MS * 5);
      const hb = f.has("stream-silent")
        ? undefined
        : setInterval(heartbeat, grant);
      const stop = () => {
        clearInterval(ev);
        if (hb) clearInterval(hb);
        res.end();
      };
      streams.add(stop);
      res.on("close", () => {
        streams.delete(stop);
        clearInterval(ev);
        if (hb) clearInterval(hb);
      });
      return;
    }
    return err(-32601, "Method not found");
  };

  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c.toString("utf8")));
    req.on("end", () => {
      if (req.method !== "POST") return void res.writeHead(404).end();
      handle(req, res, raw).catch((e: Error) =>
        send(res, 500, { error: e.message })
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    bearer: "good-token",
    close: () =>
      new Promise<void>((r) => {
        clearInterval(timer);
        for (const s of streams) s();
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}
