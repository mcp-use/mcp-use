/**
 * POLL, HDR and CURSOR checks (§18.4).
 *
 * @packageDocumentation
 */

import { HEADER_MISMATCH_CODE } from "../../codes.js";
import { EVENTS_METHODS, type EventDescriptor } from "../../wire.js";
import {
  MCP_PARAM_HEADER_PREFIX,
  scanXMcpHeaders,
} from "../../x-mcp-header.js";
import { delay, sampleArgs, type CallInit, type Ctx } from "../context.js";
import type { ConformanceCheck } from "../types.js";
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

interface PollResult {
  events: Array<Record<string, unknown>>;
  cursor: unknown;
  truncated: unknown;
  hasMore: unknown;
  nextPollMs?: unknown;
}

async function pollEvent(c: Ctx): Promise<EventDescriptor> {
  const e = await c.pickEvent("poll");
  if (!e) throw new Outcome(skip("no event offers poll delivery"));
  return e;
}

/** One `events/poll`; ends the check unless it returns a result. */
export async function poll(
  c: Ctx,
  e: EventDescriptor,
  cursor: string | null,
  extra: Record<string, unknown> = {},
  init?: CallInit
): Promise<PollResult> {
  const x = await c.call(
    EVENTS_METHODS.poll,
    { name: e.name, arguments: sampleArgs(e.inputSchema), cursor, ...extra },
    init
  );
  const r = resultOf(x, "events/poll") as unknown as PollResult;
  if (!Array.isArray(r.events))
    throw new Outcome(fail("poll result has no events array"));
  for (const ev of r.events) c.observed.push({ name: e.name, event: ev });
  return r;
}

/** The head cursor of `e`. */
async function head(c: Ctx, e: EventDescriptor): Promise<string> {
  const r = await poll(c, e, null);
  if (typeof r.cursor !== "string")
    throw new Outcome(fail("cursor:null poll returned no cursor"));
  return r.cursor;
}

/** Polls from `from` until at least `n` events are pending, without consuming them. */
async function waitForEvents(
  c: Ctx,
  e: EventDescriptor,
  from: string,
  n: number
): Promise<PollResult> {
  const deadline = Date.now() + c.timing.eventWaitMs;
  for (;;) {
    const r = await poll(c, e, from);
    if (r.events.length >= n) return r;
    if (Date.now() > deadline) {
      throw new Outcome(
        skip(
          `fewer than ${n} ${e.name} occurrence(s) within ${c.timing.eventWaitMs} ms`
        )
      );
    }
    await delay(Math.min(c.timing.quietMs, 500));
  }
}

async function headerEvent(c: Ctx): Promise<EventDescriptor> {
  return pollEvent(c);
}

/** The poll, header and cursor checks. */
export const POLL_CHECKS: readonly ConformanceCheck[] = [
  check({
    id: "HDR-MCPNAME-MISMATCH",
    profiles: ["sep-3415"],
    level: "MUST",
    cite: "events.mdx:736-748",
    async run(c) {
      const e = await headerEvent(c);
      const x = await c.call(
        EVENTS_METHODS.poll,
        { name: e.name, arguments: sampleArgs(e.inputSchema), cursor: null },
        { mcpName: `${e.name}.conformance-mismatch` }
      );
      return isError(x, HEADER_MISMATCH_CODE, 400)
        ? pass()
        : fail(expectedError(x, HEADER_MISMATCH_CODE, 400));
    },
  }),
  check({
    id: "HDR-MCPNAME-MISSING",
    profiles: ["sep-3415"],
    level: "SHOULD",
    levelFor: (_d, mode) => (mode === "strict" ? "MUST" : "SHOULD"),
    cite: "events.mdx:736-748; PLAN D9",
    async run(c) {
      const e = await headerEvent(c);
      const x = await c.call(
        EVENTS_METHODS.poll,
        { name: e.name, arguments: sampleArgs(e.inputSchema), cursor: null },
        { mcpName: null }
      );
      return isError(x, HEADER_MISMATCH_CODE, 400)
        ? pass()
        : fail(expectedError(x, HEADER_MISMATCH_CODE, 400));
    },
  }),
  check({
    id: "HDR-MCPPARAM",
    profiles: ["sep-3415"],
    level: "MUST",
    cite: "events.mdx:750-775",
    async run(c) {
      const events = await c.events();
      let target:
        | {
            e: EventDescriptor;
            header: string;
            type: string;
            path: readonly string[];
          }
        | undefined;
      for (const e of events) {
        if (!e.delivery?.includes("poll")) continue;
        const d = scanXMcpHeaders(e.inputSchema).declarations[0];
        if (d) {
          target = {
            e,
            header: `${MCP_PARAM_HEADER_PREFIX}${d.headerName}`,
            type: d.type,
            path: d.path,
          };
          break;
        }
      }
      if (!target)
        return skip("no poll event declares an x-mcp-header argument");
      const args = sampleArgs(target.e.inputSchema);
      // Give the annotated argument a value so the header is expected.
      let node: Record<string, unknown> = args;
      target.path.forEach((k, i) => {
        if (i === target.path.length - 1) {
          node[k] ??=
            target.type === "integer"
              ? 7
              : target.type === "boolean"
                ? true
                : "conformance";
        } else {
          node = (node[k] ??= {}) as Record<string, unknown>;
        }
      });
      const params = { name: target.e.name, arguments: args, cursor: null };
      const wrong =
        target.type === "integer"
          ? "999999"
          : target.type === "boolean"
            ? "false"
            : "conformance-mismatch";
      const x = await c.call(EVENTS_METHODS.poll, params, {
        headers: { [target.header]: wrong },
      });
      if (!isError(x, HEADER_MISMATCH_CODE, 400)) {
        return fail(
          `mismatched ${target.header}: ${expectedError(x, HEADER_MISMATCH_CODE, 400)}`
        );
      }
      if (c.mcpName === "strict") {
        const y = await c.call(EVENTS_METHODS.poll, params, {
          paramHeaders: false,
        });
        if (!isError(y, HEADER_MISMATCH_CODE, 400)) {
          return fail(
            `missing ${target.header}: ${expectedError(y, HEADER_MISMATCH_CODE, 400)}`
          );
        }
      }
      return pass();
    },
  }),
  check({
    id: "POLL-NULL",
    profiles: ["sep-3415"],
    level: "MUST",
    cite: "events.mdx:660",
    async run(c) {
      const r = await poll(c, await pollEvent(c), null);
      if (r.events.length !== 0)
        return fail(`cursor:null returned ${r.events.length} event(s)`);
      return typeof r.cursor === "string"
        ? pass()
        : fail(`cursor ${JSON.stringify(r.cursor)}`);
    },
  }),
  check({
    id: "POLL-ADVANCE",
    profiles: ["sep-3415"],
    level: "MUST",
    cite: "events.mdx:665-680",
    async run(c) {
      const e = await pollEvent(c);
      const c0 = await head(c, e);
      const r = await waitForEvents(c, e, c0, 1);
      if (typeof r.cursor !== "string" || r.cursor === c0) {
        return fail("the cursor did not advance past returned events");
      }
      const times = r.events.map((ev) => Date.parse(String(ev.timestamp)));
      if (times.some((t, i) => i > 0 && t < (times[i - 1] ?? 0))) {
        return fail("events out of order");
      }
      const ids = new Set(r.events.map((ev) => ev.eventId));
      const r2 = await poll(c, e, r.cursor);
      const repeated = r2.events.find((ev) => ids.has(ev.eventId));
      return repeated
        ? fail(
            `event ${String(repeated.eventId)} returned again after the cursor`
          )
        : pass();
    },
  }),
  check({
    id: "POLL-HASMORE",
    profiles: ["sep-3415"],
    level: "MUST",
    cite: "events.mdx:682",
    async run(c) {
      const e = await pollEvent(c);
      const c0 = await head(c, e);
      await waitForEvents(c, e, c0, 2);
      let r = await poll(c, e, c0, { maxEvents: 1 });
      if (r.events.length > 1)
        return fail(`maxEvents:1 returned ${r.events.length} events`);
      if (r.hasMore !== true)
        return fail("hasMore is not true with events pending past maxEvents");
      for (let i = 0; i < 1000 && r.hasMore === true; i++) {
        if (typeof r.cursor !== "string")
          return fail("no cursor to continue from");
        r = await poll(c, e, r.cursor, { maxEvents: 1 });
        if (r.events.length > 1)
          return fail(`maxEvents:1 returned ${r.events.length} events`);
      }
      return r.hasMore === false ? pass() : fail("hasMore never drained");
    },
  }),
  check({
    id: "POLL-TRUNCATED-NOT-ERROR",
    profiles: ["sep-3415"],
    level: "MUST",
    cite: "events.mdx:690",
    async run(c) {
      const e = await pollEvent(c);
      const x = await c.call(EVENTS_METHODS.poll, {
        name: e.name,
        arguments: sampleArgs(e.inputSchema),
        cursor: "c1.conformance-foreign-cursor",
      });
      const r = x.response?.result;
      if (!r)
        return fail(
          `stale cursor: expected a result, got HTTP ${x.status} ${JSON.stringify(x.response?.error ?? null)}`
        );
      return r.truncated === true
        ? pass()
        : fail("stale cursor did not report truncated:true");
    },
  }),
  check({
    id: "POLL-NEXTPOLLMS",
    profiles: ["sep-3415"],
    level: "SHOULD",
    cite: "events.mdx:684",
    async run(c) {
      const r = await poll(c, await pollEvent(c), null);
      if (r.nextPollMs === undefined) return pass("absent");
      return Number.isInteger(r.nextPollMs) && (r.nextPollMs as number) >= 1000
        ? pass()
        : fail(`nextPollMs ${JSON.stringify(r.nextPollMs)}`);
    },
  }),
  check({
    id: "POLL-NO-EVENT-CURSOR",
    profiles: ["sep-3415"],
    level: "SHOULD",
    cite: "events.mdx:676",
    async run(c) {
      const e = await pollEvent(c);
      const r = await waitForEvents(c, e, await head(c, e), 1);
      const bad = r.events.find((ev) => "cursor" in ev);
      return bad
        ? fail(`event ${String(bad.eventId)} carries a cursor`)
        : pass();
    },
  }),
];
