/**
 * SUB, UNS, DEL and NONREPLAY checks: webhook subscriptions through the
 * receiver (§18.4).
 *
 * @packageDocumentation
 */

import { HEADER_SAFE_EVENT_ID_PATTERN } from "../../ids.js";
import { verifyWebhook, WEBHOOK_HEADERS } from "../../signing.js";
import {
  EVENTS_METHODS,
  MAX_ENVELOPE_BYTES,
  type EventDescriptor,
} from "../../wire.js";
import {
  codeFor,
  forTag,
  isControl,
  maybeNext,
  newSecret,
  subscribeParams,
  type Ctx,
} from "../context.js";
import type { RpcExchange } from "../http.js";
import type { ConformanceCheck, ReceivedDelivery } from "../types.js";
import {
  check,
  expectedError,
  fail,
  isError,
  Outcome,
  pass,
  resultOf,
  skip,
} from "./util.js";

interface Sub {
  e: EventDescriptor;
  url: string;
  tag: string;
  secret: string;
  x: RpcExchange;
  result: Record<string, unknown>;
}

async function webhookEvent(c: Ctx): Promise<EventDescriptor> {
  const e = await c.pickEvent("webhook");
  if (!e) throw new Outcome(skip("no event offers webhook delivery"));
  return e;
}

/** Subscribes to a webhook event at a fresh callback; ends the check on failure. */
async function subscribe(
  c: Ctx,
  extra: Record<string, unknown> = {},
  path?: string
): Promise<Sub> {
  const e = await webhookEvent(c);
  const cb = c.callback();
  const url = path ? cb.url.replace("/c/", `/${path}/`) : cb.url;
  const secret = newSecret();
  const x = await c.call(
    EVENTS_METHODS.subscribe,
    subscribeParams(e, url, secret, extra)
  );
  if (isError(x, codeFor(c.dialect, "forbidden")) && !c.hasAuth) {
    throw new Outcome(skip("subscribe needs a principal; pass auth"));
  }
  return {
    e,
    url,
    tag: cb.tag,
    secret,
    x,
    result: resultOf(x, "events/subscribe"),
  };
}

async function unsubscribe(c: Ctx, s: Sub): Promise<void> {
  await c
    .call(EVENTS_METHODS.unsubscribe, {
      name: s.e.name,
      arguments: subscribeParams(s.e, s.url, s.secret).arguments,
      delivery: { mode: "webhook", url: s.url },
    })
    .catch(() => undefined);
}

async function withSub<T>(
  c: Ctx,
  fn: (s: Sub) => Promise<T>,
  extra?: Record<string, unknown>
): Promise<T> {
  const s = await subscribe(c, extra);
  try {
    return await fn(s);
  } finally {
    await unsubscribe(c, s);
  }
}

async function nextEvent(c: Ctx, s: Sub): Promise<ReceivedDelivery> {
  const d = await maybeNext(
    c.receiver,
    (d) => forTag(s.tag)(d) && !isControl(d),
    c.timing.eventWaitMs
  );
  if (!d) {
    throw new Outcome(
      skip(`no ${s.e.name} occurrence within ${c.timing.eventWaitMs} ms`)
    );
  }
  if (d.json && typeof d.json === "object") {
    c.observed.push({
      name: s.e.name,
      event: d.json as Record<string, unknown>,
    });
  }
  return d;
}

/** The webhook checks. */
export const WEBHOOK_CHECKS: readonly ConformanceCheck[] = [
  check({
    id: "SUB-AUTH",
    profiles: ["openai", "sep-3415"],
    level: "MUST",
    levelFor: (d) => (d === "openai" ? "SHOULD" : "MUST"),
    cite: "events.mdx:475",
    async run(c) {
      const e = await webhookEvent(c);
      const cb = c.callback();
      const x = await c.call(
        EVENTS_METHODS.subscribe,
        subscribeParams(e, cb.url, newSecret()),
        { auth: false }
      );
      if (x.status === 401) return pass("HTTP 401 before dispatch");
      const code = codeFor(c.dialect, "forbidden");
      return isError(x, code) ? pass() : fail(expectedError(x, code));
    },
  }),
  check({
    id: "SUB-VERIFY-FIRST",
    profiles: ["openai", "sep-3415"],
    level: "MUST",
    cite: "events.mdx:500-530",
    run: (c) =>
      withSub(c, async (s) => {
        const first = await maybeNext(
          c.receiver,
          forTag(s.tag),
          c.timing.quietMs
        );
        if (!first) return fail("no verification POST reached the callback");
        if (!isControl(first, "verification")) {
          return fail("the first POST was not a verification envelope");
        }
        try {
          await verifyWebhook({
            secrets: [s.secret],
            headers: first.headers,
            body: first.body,
          });
        } catch (e) {
          return fail(`verification POST signature: ${(e as Error).message}`);
        }
        return pass();
      }),
  }),
  check({
    id: "SUB-ANTI-REFLECTION",
    profiles: ["openai", "sep-3415"],
    level: "INFO",
    cite: "PLAN D29",
    async run(c) {
      const e = await webhookEvent(c);
      const cb = c.callback();
      const url = cb.url.replace("/c/", "/echo/");
      const secret = newSecret();
      const x = await c.call(
        EVENTS_METHODS.subscribe,
        subscribeParams(e, url, secret)
      );
      if (x.response?.result) {
        await c.call(EVENTS_METHODS.unsubscribe, {
          name: e.name,
          arguments: subscribeParams(e, url, secret).arguments,
          delivery: { mode: "webhook", url },
        });
        return pass("whole-body echo accepted");
      }
      return pass("whole-body echo rejected");
    },
  }),
  check({
    id: "SUB-ID-STABLE",
    profiles: ["openai", "sep-3415"],
    level: "MUST",
    cite: "events.mdx:440",
    run: (c) =>
      withSub(c, async (s) => {
        const again = await c.call(
          EVENTS_METHODS.subscribe,
          subscribeParams(s.e, s.url, s.secret)
        );
        const r = resultOf(again, "second events/subscribe");
        // TODO(events): "across restarts" needs a restart hook; only repeated calls are checked.
        return r.id === s.result.id
          ? pass()
          : fail(`id changed: ${String(s.result.id)} then ${String(r.id)}`);
      }),
  }),
  check({
    id: "SUB-NO-REVERIFY",
    profiles: ["openai", "sep-3415"],
    level: "SHOULD",
    cite: "events.mdx:590",
    run: (c) =>
      withSub(c, async (s) => {
        await maybeNext(
          c.receiver,
          (d) => forTag(s.tag)(d) && isControl(d, "verification"),
          c.timing.quietMs
        );
        resultOf(
          await c.call(
            EVENTS_METHODS.subscribe,
            subscribeParams(s.e, s.url, s.secret)
          ),
          "refresh"
        );
        const again = await maybeNext(
          c.receiver,
          (d) => forTag(s.tag)(d) && isControl(d, "verification"),
          c.timing.quietMs
        );
        return again ? fail("the refresh sent a second verification") : pass();
      }),
  }),
  check({
    id: "SUB-TTL",
    profiles: ["openai", "sep-3415"],
    level: "MUST",
    cite: "events.mdx:455-467",
    async run(c) {
      const ttlMs = 3_600_000;
      const before = Date.now();
      return withSub(
        c,
        async (s) => {
          const rb = s.result.refreshBefore;
          if (typeof rb !== "string") {
            return fail(
              `refreshBefore ${JSON.stringify(rb)} for a non-null ttlMs`
            );
          }
          const at = Date.parse(rb);
          if (Number.isNaN(at))
            return fail(`refreshBefore ${rb} is not a date`);
          return at <= before + ttlMs + 5_000
            ? pass()
            : fail(
                `refreshBefore ${rb} is later than the requested ${ttlMs} ms`
              );
        },
        { ttlMs }
      );
    },
  }),
  check({
    id: "SUB-CODES",
    profiles: ["openai", "sep-3415"],
    level: "MUST",
    cite: "events.mdx:800-830; PLAN §6.13",
    async run(c) {
      const e = await webhookEvent(c);
      const problems: string[] = [];
      const nf = codeFor(c.dialect, "notFound");
      const cb = c.callback();
      const x1 = await c.call(
        EVENTS_METHODS.subscribe,
        subscribeParams(
          { ...e, name: "conformance.no-such-event" },
          cb.url,
          newSecret()
        ),
        c.dialect === "sep-3415" ? { mcpName: "conformance.no-such-event" } : {}
      );
      if (!isError(x1, nf)) problems.push(`NotFound: ${expectedError(x1, nf)}`);
      const cee = codeFor(c.dialect, "callbackEndpointError");
      const failUrl = c.callback().url.replace("/c/", "/fail/");
      const x2 = await c.call(
        EVENTS_METHODS.subscribe,
        subscribeParams(e, failUrl, newSecret())
      );
      if (!isError(x2, cee))
        problems.push(`CallbackEndpointError: ${expectedError(x2, cee)}`);
      const pollOnly = (await c.events()).find(
        (d) => Array.isArray(d.delivery) && !d.delivery.includes("webhook")
      );
      if (pollOnly) {
        const un = codeFor(c.dialect, "unsupported");
        const x3 = await c.call(
          EVENTS_METHODS.subscribe,
          subscribeParams(pollOnly, c.callback().url, newSecret())
        );
        if (!isError(x3, un))
          problems.push(`Unsupported: ${expectedError(x3, un)}`);
      }
      // Forbidden is SUB-AUTH.
      return problems.length === 0 ? pass() : fail(problems.join("; "));
    },
  }),
  check({
    id: "UNS-MISSING",
    profiles: ["openai", "sep-3415"],
    level: "MUST",
    cite: "events.mdx:620; PLAN §6.2 unsubscribeMissing",
    async run(c) {
      const e = await webhookEvent(c);
      const p = subscribeParams(e, c.callback().url, "");
      const x = await c.call(EVENTS_METHODS.unsubscribe, {
        name: e.name,
        arguments: p.arguments,
        delivery: { mode: "webhook", url: (p.delivery as { url: string }).url },
      });
      if (c.dialect === "openai") {
        const r = x.response?.result;
        const keys = r
          ? Object.keys(r).filter((k) => k !== "_meta" && k !== "resultType")
          : undefined;
        return keys && keys.length === 0
          ? pass()
          : fail(`expected {}, got ${JSON.stringify(x.response ?? x.status)}`);
      }
      const nf = codeFor(c.dialect, "notFound");
      if (!isError(x, nf)) return fail(expectedError(x, nf));
      const data = x.response?.error?.data as
        | Record<string, unknown>
        | undefined;
      return data?.resource === "subscription" ||
        data?.kind === "subscription" ||
        data === undefined
        ? pass()
        : fail(
            `NotFound data ${JSON.stringify(data)} does not name the subscription`
          );
    },
  }),
  check({
    id: "NONREPLAY-TRUNCATED",
    profiles: ["openai", "sep-3415"],
    level: "MUST",
    cite: "events.mdx:697",
    run: (c) =>
      withSub(
        c,
        async (s) => {
          if (s.result.cursor !== null)
            return skip("event replays (cursor is not null)");
          return s.result.truncated === true
            ? fail("replay:false subscription reported truncated:true")
            : pass();
        },
        { cursor: "c1.conformance-stale-cursor" }
      ),
  }),
  check({
    id: "DEL-WEBHOOK-ID",
    profiles: ["openai", "sep-3415"],
    level: "MUST",
    cite: "PLAN §6.2 webhookId; events.mdx:540",
    run: (c) =>
      withSub(c, async (s) => {
        const d = await nextEvent(c, s);
        const id = d.headers.get(WEBHOOK_HEADERS.id);
        const eventId = (d.json as Record<string, unknown>).eventId;
        if (!id) return fail("webhook-id header missing");
        if (c.dialect === "openai") {
          return id === eventId
            ? pass()
            : fail(`webhook-id ${id} != eventId ${String(eventId)}`);
        }
        if (id === eventId) return fail("webhook-id equals eventId");
        return HEADER_SAFE_EVENT_ID_PATTERN.test(id) ||
          /^msg_[A-Za-z0-9_-]+$/.test(id)
          ? pass()
          : fail(`webhook-id ${id} is not header-safe`);
      }),
  }),
  check({
    id: "DEL-SIZE",
    profiles: ["openai", "sep-3415"],
    level: "MUST",
    cite: "events.mdx:545-560",
    run: (c) =>
      withSub(c, async (s) => {
        const d = await nextEvent(c, s);
        if (d.body.length > MAX_ENVELOPE_BYTES)
          return fail(`body is ${d.body.length} bytes`);
        const j = d.json as Record<string, unknown> | unknown[];
        if (Array.isArray(j))
          return fail("body is an array (more than one event per POST)");
        if ("type" in j) return fail("event body has a top-level type");
        if (typeof j.eventId !== "string")
          return fail("event body has no eventId");
        try {
          await verifyWebhook({
            secrets: [s.secret],
            headers: d.headers,
            body: d.body,
          });
        } catch (e) {
          return fail(`signature: ${(e as Error).message}`);
        }
        return pass();
      }),
  }),
];
