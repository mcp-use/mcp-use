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
const expectedFailuresIndex = args.indexOf("--expected-failures");
const expectedFailuresFile =
  expectedFailuresIndex === -1 ? undefined : args[expectedFailuresIndex + 1];

if (!root) {
  console.error(
    "Usage: summarize-conformance <results-dir> [--runner <package>] [--spec-versions <versions>] [--expected-failures <file>] [--output <file>]"
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

const expectedFailures = expectedFailuresFile
  ? readFileSync(expectedFailuresFile, "utf8")
      .split("\n")
      .map((line) => line.match(/^\s*-\s+([^#\s]+)(?:\s+#.*)?$/u)?.[1])
      .filter(Boolean)
  : [];

function isExpectedOutcome(suite, check) {
  return expectedFailures.some((entry) => {
    const separator = entry.indexOf(":");
    const scenario = separator === -1 ? entry : entry.slice(0, separator);
    const checkId = separator === -1 ? undefined : entry.slice(separator + 1);
    return (
      suite.includes(`/server/server-${scenario}-`) &&
      (!checkId || check.id === checkId)
    );
  });
}

for (const file of files.sort()) {
  const checks = JSON.parse(readFileSync(file, "utf8"));
  const suite = relative(root, file).replace(/\/checks\.json$/u, "");
  const passed = checks.filter((check) => check.status === "SUCCESS").length;
  const failures = checks.filter((check) => check.status === "FAILURE");
  const warningChecks = checks.filter((check) => check.status === "WARNING");
  const expectedFailuresCount = failures.filter((check) =>
    isExpectedOutcome(suite, check)
  ).length;
  const unexpectedFailures = failures.length - expectedFailuresCount;
  const expectedWarnings = warningChecks.filter((check) =>
    isExpectedOutcome(suite, check)
  ).length;
  const unexpectedWarnings = warningChecks.length - expectedWarnings;
  rows.push({
    suite,
    passed,
    expectedFailures: expectedFailuresCount,
    unexpectedFailures,
    expectedWarnings,
    unexpectedWarnings,
    // INFO records describe the scenario and are not test outcomes. Match
    // the conformance runner's score convention: total = passed + failed.
    total: passed + failures.length,
  });
}

const totals = rows.reduce(
  (result, row) => ({
    passed: result.passed + row.passed,
    expectedFailures: result.expectedFailures + row.expectedFailures,
    unexpectedFailures: result.unexpectedFailures + row.unexpectedFailures,
    expectedWarnings: result.expectedWarnings + row.expectedWarnings,
    unexpectedWarnings: result.unexpectedWarnings + row.unexpectedWarnings,
    total: result.total + row.total,
  }),
  {
    passed: 0,
    expectedFailures: 0,
    unexpectedFailures: 0,
    expectedWarnings: 0,
    unexpectedWarnings: 0,
    total: 0,
  }
);

const lines = [
  "**Runner:** `" + (runner ?? "unspecified") + "`",
  "**Spec versions:** `" + (specVersions ?? "unspecified") + "`",
  "",
  `**Score: ${totals.passed}/${totals.total} passed** (${totals.expectedFailures} expected failures, ${totals.unexpectedFailures} unexpected failures, ${totals.expectedWarnings} expected warnings, ${totals.unexpectedWarnings} unexpected warnings)`,
  "",
  "| Suite | Score | Expected failures | Unexpected failures | Expected warnings | Unexpected warnings |",
  "| --- | ---: | ---: | ---: | ---: | ---: |",
  ...rows.map(
    (row) =>
      `| \`${row.suite}\` | ${row.passed}/${row.total} | ${row.expectedFailures} | ${row.unexpectedFailures} | ${row.expectedWarnings} | ${row.unexpectedWarnings} |`
  ),
];

const summary = `${lines.join("\n")}\n`;
if (output) writeFileSync(output, summary);
else process.stdout.write(summary);

if (totals.unexpectedFailures > 0) process.exitCode = 1;
