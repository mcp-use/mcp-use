/**
 * JSON rendering of a conformance report: fixed key order, two-space indent.
 *
 * @packageDocumentation
 */

import type { ConformanceReport } from "./types.js";

/**
 * Renders a report as JSON.
 *
 * @param r - A report from `runConformance`.
 * @returns The JSON document, newline-terminated.
 */
export function toJSON(r: ConformanceReport): string {
  const ordered: ConformanceReport = {
    target: r.target,
    startedAt: r.startedAt,
    dialects: r.dialects,
    results: r.results.map((x) => ({
      id: x.id,
      dialect: x.dialect,
      level: x.level,
      outcome: x.outcome,
      ...(x.detail === undefined ? {} : { detail: x.detail }),
      ms: x.ms,
    })),
    summary: {
      mustFailed: r.summary.mustFailed,
      shouldFailed: r.summary.shouldFailed,
      passed: r.summary.passed,
      skipped: r.summary.skipped,
    },
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}
