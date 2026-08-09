import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const [root, ...args] = process.argv.slice(2);
const outputIndex = args.indexOf("--output");
const output = outputIndex === -1 ? undefined : args[outputIndex + 1];
const runnerIndex = args.indexOf("--runner");
const runner = runnerIndex === -1 ? undefined : args[runnerIndex + 1];
const specVersionsIndex = args.indexOf("--spec-versions");
const specVersions =
  specVersionsIndex === -1 ? undefined : args[specVersionsIndex + 1];

if (!root) {
  console.error(
    "Usage: summarize-conformance <results-dir> [--runner <package>] [--spec-versions <versions>] [--output <file>]"
  );
  process.exit(2);
}

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(file);
    return entry.name === "checks.json" ? [file] : [];
  });
}

const files = statSync(root, { throwIfNoEntry: false }) ? filesUnder(root) : [];
const rows = [];

for (const file of files.sort()) {
  const checks = JSON.parse(readFileSync(file, "utf8"));
  const passed = checks.filter((check) => check.status === "SUCCESS").length;
  const failed = checks.filter((check) => check.status === "FAILURE").length;
  const warnings = checks.filter((check) => check.status === "WARNING").length;
  rows.push({
    suite: relative(root, file).replace(/\/checks\.json$/u, ""),
    passed,
    failed,
    warnings,
    total: checks.length,
  });
}

const totals = rows.reduce(
  (result, row) => ({
    passed: result.passed + row.passed,
    failed: result.failed + row.failed,
    warnings: result.warnings + row.warnings,
    total: result.total + row.total,
  }),
  { passed: 0, failed: 0, warnings: 0, total: 0 }
);

const lines = [
  "**Runner:** `" + (runner ?? "unspecified") + "`",
  "**Spec versions:** `" + (specVersions ?? "unspecified") + "`",
  "",
  `**Score: ${totals.passed}/${totals.total} passed** (${totals.failed} failed, ${totals.warnings} warnings)`,
  "",
  "| Suite | Score | Failed | Warnings |",
  "| --- | ---: | ---: | ---: |",
  ...rows.map(
    (row) =>
      `| \`${row.suite}\` | ${row.passed}/${row.total} | ${row.failed} | ${row.warnings} |`
  ),
];

const summary = `${lines.join("\n")}\n`;
if (output) writeFileSync(output, summary);
else process.stdout.write(summary);

if (totals.failed > 0) process.exitCode = 1;
