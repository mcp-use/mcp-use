/**
 * Push runner (PLAN.md §9.5.2): `events/stream` on the lane, reconnect with
 * jitter, backoff on failure, fallback when `active` never arrives.
 *
 * @internal
 */

import { decodeEventsError } from "@mcp-use/events-core";
import { DEFAULT_ACTIVE_TIMEOUT_MS } from "../connection.js";
import {
  backoffMs,
  classifyFailure,
  sleep,
  type RunnerContext,
  type RunnerExit,
} from "./poll.js";

/** Options of {@link runPush}. */
export interface PushRunnerOptions {
  /** Replay floor for the first request. */
  maxAgeMs?: number;
  /** Time to wait for `active`; default 30 s. */
  activeTimeoutMs?: number;
}

/**
 * Run the push loop until stopped, terminated or a fallback is needed.
 *
 * @param ctx - Runner context.
 * @param opts - Replay floor and active timeout.
 * @returns How the runner stopped; `fallback` when `active` never arrived.
 */
export async function runPush(
  ctx: RunnerContext,
  opts: PushRunnerOptions = {}
): Promise<RunnerExit> {
  const st = { attempt: 0, everActive: false };
  let first = true;
  const random = ctx.random ?? Math.random;
  while (!ctx.signal.aborted) {
    let wait = 0;
    try {
      const conn = await ctx.connection();
      const maxAgeMs = first
        ? (opts.maxAgeMs ?? ctx.record.maxAgeMs)
        : undefined;
      first = false;
      const pendingDeliveries: Promise<void>[] = [];
      const outcome = await conn.streamEvents(
        {
          name: ctx.record.name,
          arguments: ctx.record.args,
          cursor: ctx.record.cursor,
          ...(maxAgeMs !== undefined && ctx.record.cursor === null
            ? { maxAgeMs }
            : {}),
        },
        {
          onActive: (p) => {
            st.everActive = true;
            st.attempt = 0;
            if (p.truncated) ctx.gap({ cursor: p.cursor, reason: "truncated" });
            ctx.setCursor(p.cursor);
          },
          onEvent: (e) => {
            const d = ctx.deliver(e).then(() => {
              if (e.cursor !== undefined) ctx.setCursor(e.cursor ?? null);
            });
            pendingDeliveries.push(d);
          },
          onHeartbeat: (h) => ctx.setCursor(h.cursor),
        },
        {
          signal: ctx.signal,
          activeTimeoutMs: opts.activeTimeoutMs ?? DEFAULT_ACTIVE_TIMEOUT_MS,
        }
      );
      await Promise.allSettled(pendingDeliveries);
      if (outcome.end === "aborted") break;
      if (outcome.end === "terminated") {
        const error = outcome.error ?? { code: 0, message: "terminated" };
        ctx.terminate({
          kind: decodeEventsError(error) ?? "terminated",
          code: error.code,
          ...(error.data ? { data: error.data } : {}),
        });
        return { kind: "terminated" };
      }
      if (outcome.end === "no_active" && !st.everActive) {
        return { kind: "fallback", to: "poll" };
      }
      if (outcome.end === "closed") {
        wait = Math.floor(random() * 1_000);
      } else if (outcome.error) {
        const decoded = decodeEventsError(outcome.error);
        if (
          decoded === "notFound" ||
          decoded === "forbidden" ||
          decoded === "invalidParams" ||
          decoded === "unsupported"
        ) {
          ctx.terminate({
            kind: decoded,
            code: outcome.error.code,
            ...(outcome.error.data ? { data: outcome.error.data } : {}),
          });
          return { kind: "terminated" };
        }
        wait = backoffMs(st.attempt++, random);
      } else {
        wait = backoffMs(st.attempt++, random);
      }
    } catch (err) {
      if (ctx.signal.aborted) break;
      const f = classifyFailure(err);
      if (f.action === "terminal") {
        ctx.terminate(f.termination);
        return { kind: "terminated" };
      }
      if (f.action === "auth") return { kind: "auth" };
      wait = f.action === "wait" ? f.ms : backoffMs(st.attempt++, random);
    }
    if (wait > 0) await sleep(wait, ctx.signal);
  }
  return { kind: "stopped" };
}
