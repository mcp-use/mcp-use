import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { RESULTS_DIR } from "./tasks.js";
import type { RunResult } from "./types.js";

/** Cross-run trend table: tasks×variants as rows, runs as columns, success rate per cell. */
async function main(): Promise<void> {
  let runDirs: string[];
  try {
    runDirs = (await readdir(RESULTS_DIR, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    console.log("No results yet — run `pnpm eval` first.");
    return;
  }

  const runs: RunResult[] = [];
  for (const dir of runDirs) {
    try {
      runs.push(
        JSON.parse(
          await readFile(join(RESULTS_DIR, dir, "run.json"), "utf8")
        ) as RunResult
      );
    } catch {
      /* incomplete run dir */
    }
  }
  // Run ids lead with the task name, so chronological order comes from startedAt.
  runs.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  if (runs.length === 0) {
    console.log("No completed runs found.");
    return;
  }

  const runLabels = runs.map((r) => r.startedAt.slice(0, 16).replace("T", " "));

  const rows = new Set<string>();
  for (const run of runs)
    for (const t of run.trials) rows.add(`${t.task} · ${t.variant}`);

  const successTable: string[][] = [["task · variant", ...runLabels]];
  for (const row of [...rows].sort()) {
    const [task, variant] = row.split(" · ");
    const cells = runs.map((run) => {
      const trials = run.trials.filter(
        (t) => t.task === task && t.variant === variant
      );
      if (trials.length === 0) return "—";
      const ok = trials.filter((t) => t.outcome.success).length;
      return `${ok}/${trials.length}`;
    });
    successTable.push([row, ...cells]);
  }
  console.log("Success rate");
  printTable(successTable);

  // Friction trends: per detector, the share of trials it fired in. This is
  // the longitudinal idiom view — each detector trends independently instead
  // of being blended into a score.
  const detectors = new Set<string>();
  for (const run of runs)
    for (const t of run.trials)
      for (const f of [
        ...t.idiom.findings,
        ...(t.judge?.processFindings ?? []),
      ])
        detectors.add(f.detector);
  if (detectors.size > 0) {
    const frictionTable: string[][] = [["detector", ...runLabels]];
    for (const detector of [...detectors].sort()) {
      const cells = runs.map((run) => {
        const hit = run.trials.filter((t) =>
          [...t.idiom.findings, ...(t.judge?.processFindings ?? [])].some(
            (f) => f.detector === detector
          )
        ).length;
        return `${hit}/${run.trials.length}`;
      });
      frictionTable.push([detector, ...cells]);
    }
    console.log("\nFriction rate (trials hit / trials)");
    printTable(frictionTable);
  }
}

function printTable(table: string[][]): void {
  const widths = table[0].map((_, i) =>
    Math.max(...table.map((r) => r[i].length))
  );
  for (const row of table) {
    console.log(row.map((c, i) => c.padEnd(widths[i])).join("  "));
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
