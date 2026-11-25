/**
 * Catalog rows whose run needs a fault-injecting receiver, a second process
 * or the platform, and the hosting rows (P11). Each row keeps its final id,
 * level and citation; the unbuilt ones skip with a stated reason.
 *
 * @packageDocumentation
 */

import type { Ctx } from "../context.js";
import type { ConformanceCheck } from "../types.js";
import { check, fail, pass, skip } from "./util.js";

function later(
  id: string,
  profiles: ConformanceCheck["profiles"],
  level: ConformanceCheck["level"],
  cite: string,
  why: string
): ConformanceCheck {
  return check({
    id,
    profiles,
    level,
    cite,
    // TODO(events): implement; see `why`.
    run: async () => skip(`not automated yet: ${why}`),
  });
}

/** Rows not yet automated, in catalog order. */
export const PENDING_CHECKS: readonly ConformanceCheck[] = [
  later(
    "LIST-CHANGED",
    ["sep-3415"],
    "SHOULD",
    "events.mdx:178-192",
    "needs a subscriptions/listen stream reader"
  ),
  later(
    "VERIFY-WELLKNOWN",
    ["openai", "sep-3415"],
    "SHOULD",
    "PLAN D29",
    "needs the receiver to serve /.well-known/mcp-webhook-receiver.json on an https origin"
  ),
  later(
    "DEL-RETRY",
    ["openai", "sep-3415"],
    "MUST",
    "events.mdx:560-575",
    "needs a fault-injecting receiver (5xx then 410/413)"
  ),
  later(
    "DEL-NO-REDIRECT",
    ["openai", "sep-3415"],
    "MUST",
    "PLAN D29 SSRF",
    "needs a receiver that answers 307"
  ),
  later(
    "DEL-ROTATION",
    ["openai", "sep-3415"],
    "SHOULD",
    "events.mdx:580",
    "needs a secret rotation during live delivery"
  ),
  later(
    "CTL-ENVELOPES",
    ["openai", "sep-3415"],
    "MUST",
    "events.mdx:600-615",
    "needs a gap/revoke trigger on the server"
  ),
  later(
    "SCOPE-REQUESTED",
    ["openai"],
    "WARN",
    "OpenAI MCP Events page",
    "needs the PRM / sign-in challenge reader"
  ),
  later(
    "ANON-WEBHOOK",
    ["openai"],
    "WARN",
    "PLAN §6.9",
    "needs a signed-out subscribe that is expected to succeed"
  ),
  later(
    "WEBHOOK-WATERMARK-SAFE",
    ["sep-3415"],
    "MUST",
    "events.mdx:690-700",
    "needs a fault-injected receiver"
  ),
  later(
    "WEBHOOK-REPLAY-LAPSED",
    ["sep-3415"],
    "SHOULD",
    "events.mdx:455-470",
    "needs a subscription that expires during the run"
  ),
];

/** The hosting rows (P11); MUST on Manufact, skipped elsewhere. */
export const HOSTING_CHECKS: readonly ConformanceCheck[] = [
  check({
    id: "HOST-BINDING",
    profiles: ["openai"],
    level: "MUST",
    cite: "PLAN P11, §12.4",
    async run(c) {
      // TODO(events): confirm the health route path against WP-26 (`{basePath}/_mcp-use/events/health`).
      const r = await fetchHealth(c);
      if (!r)
        return skip("no events health endpoint (not a Manufact deployment)");
      return r.binding === "platform"
        ? pass()
        : fail(`health.binding ${JSON.stringify(r.binding)}`);
    },
  }),
  check({
    id: "HOST-SENDER",
    profiles: ["openai"],
    level: "MUST",
    cite: "PLAN P11, §12.4",
    async run(c) {
      const r = await fetchHealth(c);
      if (!r)
        return skip("no events health endpoint (not a Manufact deployment)");
      return r.sender === "node-pinned+proxy"
        ? pass()
        : fail(`health.sender ${JSON.stringify(r.sender)}`);
    },
  }),
  later(
    "HOST-TICK",
    ["openai"],
    "MUST",
    "PLAN P11, §12.4",
    "needs the platform bearer"
  ),
];

async function fetchHealth(
  c: Ctx
): Promise<Record<string, unknown> | undefined> {
  const url = c.url;
  const base = url.pathname.replace(/\/mcp\/?$/, "");
  try {
    const res = await c.fetch(new URL(`${base}/_mcp-use/events/health`, url), {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return undefined;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
