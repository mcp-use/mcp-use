/**
 * JUnit XML rendering of a conformance report. MUST and SHOULD failures are
 * `<failure>`s; INFO and WARN failures are reported in `<system-out>` only.
 *
 * @packageDocumentation
 */

import type { ConformanceReport } from "./types.js";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const secs = (ms: number): string => (ms / 1000).toFixed(3);

function counts(rs: ConformanceReport["results"]) {
  return {
    tests: rs.length,
    failures: rs.filter(
      (x) =>
        x.outcome === "fail" && (x.level === "MUST" || x.level === "SHOULD")
    ).length,
    skipped: rs.filter((x) => x.outcome === "skip").length,
    ms: rs.reduce((n, x) => n + x.ms, 0),
  };
}

/**
 * Renders a report as JUnit XML.
 *
 * @param r - A report from `runConformance`.
 * @returns The JUnit XML document.
 */
export function toJUnit(r: ConformanceReport): string {
  const all = counts(r.results);
  const lines = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<testsuites name="mcp-events-conformance" tests="${all.tests}" failures="${all.failures}" skipped="${all.skipped}" time="${secs(all.ms)}">`,
  ];
  for (const dialect of r.dialects) {
    const rs = r.results.filter((x) => x.dialect === dialect);
    const c = counts(rs);
    lines.push(
      `  <testsuite name="${esc(dialect)}" tests="${c.tests}" failures="${c.failures}" skipped="${c.skipped}" time="${secs(c.ms)}" timestamp="${esc(r.startedAt)}">`,
      `    <properties><property name="target" value="${esc(r.target)}"/></properties>`
    );
    for (const x of rs) {
      const family = x.id.split("-")[0] ?? x.id;
      const open = `    <testcase classname="${esc(`${dialect}.${family}`)}" name="${esc(`${x.id} [${x.level}]`)}" time="${secs(x.ms)}"`;
      const detail = esc(x.detail ?? "");
      if (x.outcome === "pass") {
        lines.push(`${open}/>`);
      } else if (x.outcome === "skip") {
        lines.push(
          `${open}>`,
          `      <skipped message="${detail}"/>`,
          `    </testcase>`
        );
      } else if (x.level === "MUST" || x.level === "SHOULD") {
        lines.push(
          `${open}>`,
          `      <failure message="${detail}" type="${x.level}"/>`,
          `    </testcase>`
        );
      } else {
        lines.push(
          `${open}>`,
          `      <system-out>${x.level}: ${detail}</system-out>`,
          `    </testcase>`
        );
      }
    }
    lines.push(`  </testsuite>`);
  }
  lines.push(`</testsuites>`, "");
  return lines.join("\n");
}
