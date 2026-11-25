/**
 * CAP, LIST, DESC and PAYLOAD checks (§18.4).
 *
 * @packageDocumentation
 */

import {
  DELIVERY_MODES,
  EVENTS_EXTENSION_ID,
  EVENTS_METHODS,
} from "../../wire.js";
import type { Ctx } from "../context.js";
import { validateJsonSchema } from "../schema.js";
import type { ConformanceCheck } from "../types.js";
import { check, fail, pass, skip } from "./util.js";

async function list(c: Ctx) {
  try {
    return await c.events();
  } catch (e) {
    return fail(`events/list: ${(e as Error).message}`);
  }
}

/** The capability and listing checks. */
export const CAPABILITY_CHECKS: readonly ConformanceCheck[] = [
  check({
    id: "CAP-TOP",
    profiles: ["openai"],
    level: "MUST",
    cite: "PLAN §6.4 D8; OpenAI MCP Events page",
    async run(c) {
      const served: string[] = [];
      const missing: string[] = [];
      for (const era of ["legacy", "modern"] as const) {
        const caps = await c.capabilities(era);
        if (!caps) continue;
        served.push(era);
        if (caps.events === undefined) missing.push(era);
      }
      if (served.length === 0)
        return fail("neither initialize nor server/discover answered");
      if (missing.length > 0)
        return fail(`top-level events missing on ${missing.join(", ")}`);
      return pass();
    },
  }),
  check({
    id: "CAP-EXT",
    profiles: ["sep-3415"],
    level: "MUST",
    cite: "events.mdx:59",
    async run(c) {
      const caps = await c.capabilities("modern");
      if (!caps) return fail("server/discover did not answer");
      const ext = caps.extensions as Record<string, unknown> | undefined;
      return ext?.[EVENTS_EXTENSION_ID] !== undefined
        ? pass()
        : fail(
            `extensions["${EVENTS_EXTENSION_ID}"] missing on server/discover`
          );
    },
  }),
  check({
    id: "CAP-EXT-LEGACY",
    profiles: ["sep-3415"],
    level: "INFO",
    cite: "PLAN §6.4 D8",
    async run(c) {
      const caps = await c.capabilities("legacy");
      if (!caps) return skip("legacy initialize not served");
      const ext = caps.extensions as Record<string, unknown> | undefined;
      return ext?.[EVENTS_EXTENSION_ID] === undefined
        ? pass()
        : fail("extension key advertised on legacy initialize");
    },
  }),
  check({
    id: "LIST-SHAPE",
    profiles: ["openai", "sep-3415"],
    level: "MUST",
    cite: "events.mdx:80-120",
    async run(c) {
      const events = await list(c);
      if (!Array.isArray(events)) return events;
      if (events.length === 0) return fail("events/list returned no events");
      for (const e of events) {
        if (typeof e.name !== "string" || e.name === "")
          return fail("descriptor without a name");
        if (
          !Array.isArray(e.delivery) ||
          e.delivery.length === 0 ||
          !e.delivery.every((m) => DELIVERY_MODES.includes(m))
        ) {
          return fail(
            `${e.name}: delivery ${JSON.stringify(e.delivery)} is not a non-empty subset of the modes`
          );
        }
        if (typeof e.inputSchema !== "object" || e.inputSchema === null) {
          return fail(`${e.name}: inputSchema missing`);
        }
        if (typeof e.payloadSchema !== "object" || e.payloadSchema === null) {
          return fail(`${e.name}: payloadSchema missing`);
        }
      }
      return pass();
    },
  }),
  check({
    id: "LIST-SIGNED-OUT",
    profiles: ["openai"],
    level: "SHOULD",
    cite: "PLAN §6.9 mixedAuth",
    async run(c) {
      if (!c.hasAuth)
        return skip(
          "no bearer configured; signed-in and signed-out lists are the same request"
        );
      const x = await c.call(EVENTS_METHODS.list, {}, { auth: false });
      if (x.status === 401)
        return skip(
          "server requires sign-in for every request (not mixedAuth)"
        );
      const r = x.response?.result;
      if (!r) return fail(`signed-out events/list failed: HTTP ${x.status}`);
      const events = (r.events ?? []) as Array<{ delivery?: string[] }>;
      return events.some((e) => e.delivery?.includes("webhook"))
        ? pass()
        : fail("signed-out events/list lists no webhook events");
    },
  }),
  check({
    id: "LIST-OPENAI-MODES",
    profiles: ["openai"],
    level: "SHOULD",
    cite: "PLAN §6.2 listedModes webhookOnly",
    async run(c) {
      const events = await list(c);
      if (!Array.isArray(events)) return events;
      const bad = events.find(
        (e) => JSON.stringify(e.delivery) !== JSON.stringify(["webhook"])
      );
      return bad
        ? fail(`${bad.name}: delivery ${JSON.stringify(bad.delivery)}`)
        : pass();
    },
  }),
  check({
    id: "DESC-QUALITY",
    profiles: ["openai"],
    level: "INFO",
    cite: "OpenAI MCP Events page (description steers the reaction)",
    async run(c) {
      const events = await list(c);
      if (!Array.isArray(events)) return events;
      // TODO(events): "phrased as an action" needs a heuristic; only the length is checked.
      const short = events.filter((e) => (e.description ?? "").length < 40);
      return short.length === 0
        ? pass()
        : fail(
            `description under 40 characters: ${short.map((e) => e.name).join(", ")}`
          );
    },
  }),
  check({
    id: "PAYLOAD-SCHEMA",
    profiles: ["openai", "sep-3415"],
    level: "SHOULD",
    cite: "events.mdx:100",
    async run(c) {
      const events = await list(c);
      if (!Array.isArray(events)) return events;
      if (c.observed.length === 0) {
        return skip("no event occurrence observed during the run");
      }
      for (const o of c.observed) {
        const d = events.find((e) => e.name === o.name);
        if (!d) continue;
        const problem = validateJsonSchema(d.payloadSchema, o.event.data);
        if (problem)
          return fail(`${o.name} ${String(o.event.eventId)}: ${problem}`);
      }
      return pass(`${c.observed.length} occurrence(s) validated`);
    },
  }),
];
