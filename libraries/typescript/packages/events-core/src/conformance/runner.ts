/**
 * The raw-HTTP conformance runner (D27). It never probes `events/list` on a
 * server that does not advertise Events to the profile (`events.mdx:78`).
 *
 * @packageDocumentation
 */

import { CATALOG } from "./catalog.js";
import { createCtx, DEFAULT_TIMING, type Timing } from "./context.js";
import { createSigningReceiver } from "./receiver.js";
import type {
  ConformanceCheck,
  ConformanceOptions,
  ConformanceReport,
  ConformanceResultEntry,
  ReceiverHandle,
} from "./types.js";

/** Families whose checks need deliveries to reach a receiver. */
const RECEIVER_FAMILIES: ReadonlySet<string> = new Set([
  "SUB",
  "DEL",
  "NONREPLAY",
]);
/** Families that run even when Events are not advertised. */
const ALWAYS_FAMILIES: ReadonlySet<string> = new Set(["CAP", "HOST"]);

/** Internal knobs for tests and embedders; not part of the public API. */
export interface RunnerInternals {
  /** Timing overrides. */
  timing?: Partial<Timing>;
  /** A catalog other than {@link CATALOG}. */
  catalog?: readonly ConformanceCheck[];
}

/** Whether `id` is selected by `only` (exact ids, prefixes ending in `-`, or bare family names such as `POLL`). */
export function selected(id: string, only?: readonly string[]): boolean {
  if (!only || only.length === 0) return true;
  return only.some(
    (o) =>
      o === id ||
      (o.endsWith("-") && id.startsWith(o)) ||
      (!o.includes("-") && id.startsWith(`${o}-`))
  );
}

const noReceiver: ReceiverHandle = {
  url: "http://127.0.0.1:9",
  next: (_p, ms) =>
    new Promise((_r, reject) =>
      setTimeout(() => reject(new Error("no receiver")), Math.min(ms, 0))
    ),
  close: async () => undefined,
};

/** {@link runConformance} with internal knobs. */
export async function runConformanceWith(
  o: ConformanceOptions,
  internals: RunnerInternals = {}
): Promise<ConformanceReport> {
  const url = new URL(o.url);
  const startedAt = new Date().toISOString();
  const catalog = internals.catalog ?? CATALOG;
  const timing = { ...DEFAULT_TIMING, ...internals.timing };
  const mcpName = o.mcpName ?? "lenient";
  const planned = catalog.filter((c) => selected(c.id, o.only));

  let receiver = o.receiver;
  let ownReceiver: ReceiverHandle | undefined;
  let receiverProblem: string | undefined;
  if (!receiver && planned.some((c) => RECEIVER_FAMILIES.has(c.family))) {
    try {
      ownReceiver = await createSigningReceiver();
      receiver = ownReceiver;
    } catch (e) {
      receiverProblem = `no receiver: ${(e as Error).message}`;
    }
  }

  const results: ConformanceResultEntry[] = [];
  try {
    for (const dialect of o.dialects) {
      const c = createCtx({
        url,
        dialect,
        fetch: o.fetch ?? globalThis.fetch.bind(globalThis),
        headers: o.headers ?? {},
        ...(o.auth ? { bearer: o.auth.bearer } : {}),
        mcpName,
        receiver: receiver ?? noReceiver,
        timing,
      });
      let advertised: boolean | undefined;
      for (const check of planned) {
        if (!check.profiles.includes(dialect)) continue;
        const level = check.levelFor?.(dialect, mcpName) ?? check.level;
        const t0 = Date.now();
        let outcome: ConformanceResultEntry["outcome"];
        let detail: string | undefined;
        try {
          if (!ALWAYS_FAMILIES.has(check.family)) {
            advertised ??= await c.advertised().catch(() => false);
          }
          if (!ALWAYS_FAMILIES.has(check.family) && !advertised) {
            outcome = "skip";
            detail = "server does not advertise Events to this profile";
          } else if (receiverProblem && RECEIVER_FAMILIES.has(check.family)) {
            outcome = "skip";
            detail = receiverProblem;
          } else {
            const r = await check.run(c);
            outcome = r.outcome;
            detail = r.detail;
          }
        } catch (e) {
          outcome = "fail";
          detail = `threw: ${(e as Error).message}`;
        }
        results.push({
          id: check.id,
          dialect,
          level,
          outcome,
          ...(detail === undefined ? {} : { detail }),
          ms: Date.now() - t0,
        });
      }
    }
  } finally {
    await ownReceiver?.close();
  }

  return {
    target: url.toString(),
    startedAt,
    dialects: [...o.dialects],
    results,
    summary: {
      mustFailed: results.filter(
        (r) => r.outcome === "fail" && r.level === "MUST"
      ).length,
      shouldFailed: results.filter(
        (r) => r.outcome === "fail" && r.level === "SHOULD"
      ).length,
      passed: results.filter((r) => r.outcome === "pass").length,
      skipped: results.filter((r) => r.outcome === "skip").length,
    },
  };
}

/**
 * Runs the catalog against a server over raw HTTP and reports every check.
 *
 * @param o - Target, profiles and options.
 * @returns The report.
 */
export function runConformance(
  o: ConformanceOptions
): Promise<ConformanceReport> {
  return runConformanceWith(o);
}
