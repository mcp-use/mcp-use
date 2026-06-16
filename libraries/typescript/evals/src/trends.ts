import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { RESULTS_DIR } from "./tasks.js";
import { TrendRunSchema, type TrendRun } from "./types.js";

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

  const runs: TrendRun[] = [];
  for (const dir of runDirs) {
    let raw: string;
    try {
      raw = await readFile(join(RESULTS_DIR, dir, "run.json"), "utf8");
    } catch {
      continue; // no run.json — incomplete or foreign dir, skip quietly
    }
    const parsed = TrendRunSchema.safeParse(tryJson(raw));
    if (!parsed.success) {
      console.warn(`⚠️  skipping ${dir}: run.json is not a valid run result`);
      continue;
    }
    runs.push(parsed.data);
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

  const readinessTable: string[][] = [["task · variant", ...runLabels]];
  for (const row of [...rows].sort()) {
    const [task, variant] = row.split(" · ");
    const cells = runs.map((run) => {
      const scores = run.trials
        .filter((t) => t.task === task && t.variant === variant)
        .map((t) => t.readiness?.score)
        .filter((score): score is number => typeof score === "number");
      if (scores.length === 0) return "—";
      return String(mean(scores));
    });
    readinessTable.push([row, ...cells]);
  }
  console.log("\nMean readiness");
  printTable(readinessTable);

  // Penalty trends: per deterministic readiness detector, the share of trials
  // it fired in. Judge findings are advisory and deliberately excluded.
  const detectors = new Set<string>();
  for (const run of runs)
    for (const t of run.trials)
      for (const p of t.readiness?.penalties ?? []) detectors.add(p.detector);
  if (detectors.size > 0) {
    const penaltyTable: string[][] = [["detector", ...runLabels]];
    for (const detector of [...detectors].sort()) {
      const cells = runs.map((run) => {
        const hit = run.trials.filter((t) =>
          (t.readiness?.penalties ?? []).some((p) => p.detector === detector)
        ).length;
        return `${hit}/${run.trials.length}`;
      });
      penaltyTable.push([detector, ...cells]);
    }
    console.log("\nReadiness penalty rate (trials hit / trials)");
    printTable(penaltyTable);
  }
}

function tryJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
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

function mean(xs: number[]): number {
  return Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
