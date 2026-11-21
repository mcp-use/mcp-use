import { elapsed, fields, plain, prose } from "../../core/format.js";
import type { ChecklistRun } from "./api.js";

type Check = NonNullable<ChecklistRun["checks"]>[number];
/** A check result normalized for display and `--fail-on`. */
export type CheckStatus =
  | "passed"
  | "failed"
  | "warnings"
  | "skipped"
  | "pending"
  | "unknown";
const categories: Record<string, string> = {
  connectivity: "Protocol",
  protocol: "Protocol checks",
  "tool-metadata": "Tools",
  "resource-metadata": "MCP Apps",
  resources: "Resources",
  "client-compatibility": "Client compatibility",
  metadata: "Metadata",
  robustness: "Robustness",
  integrity: "Integrity",
  security: "Security",
  configuration: "Configuration",
  view: "MCP Apps",
  content: "Content",
  "policy-conformance": "Policy review",
  e2e: "Live tests",
};
/** The meta-check summarizing the policy review; not a concern of its own. */
const POLICY_SUMMARY = "policy-review-summary";

function isPolicy(check: Check): boolean {
  return check.category === "policy-conformance";
}

/** Policy findings that may need store review, counted as the dashboard does. */
function policyConcerns(checks: Check[]): Check[] {
  return checks.filter(
    (check) =>
      isPolicy(check) &&
      check.checkId !== POLICY_SUMMARY &&
      ["failed", "warnings"].includes(checkStatus(check))
  );
}

/** Normalize an API check status, folding low-severity failures into warnings. */
export function checkStatus(check: Check): CheckStatus {
  switch (check.status.toLowerCase()) {
    case "pass":
    case "passed":
    case "success":
      return "passed";
    case "fail":
    case "failed":
    case "error":
      // Policy findings are advisory, as on the dashboard: they may need
      // store review but are not failed publishing checks.
      return check.severity === "warning" ||
        check.severity === "info" ||
        check.category === "policy-conformance"
        ? "warnings"
        : "failed";
    case "warn":
    case "warning":
      return "warnings";
    case "skip":
    case "skipped":
    case "not_applicable":
      return "skipped";
    case "pending":
    case "running":
      return "pending";
    default:
      return "unknown";
  }
}
function counts(checks: Check[]): string {
  const totals: Record<CheckStatus, number> = {
    passed: 0,
    failed: 0,
    warnings: 0,
    skipped: 0,
    pending: 0,
    unknown: 0,
  };
  for (const check of checks) totals[checkStatus(check)]++;
  return (Object.entries(totals) as [CheckStatus, number][])
    .filter(([, count]) => count)
    .map(
      ([kind, count]) =>
        `${count} ${kind === "warnings" && count === 1 ? "warning" : kind}`
    )
    .join(" · ");
}
function groupStatus(checks: Check[]): CheckStatus {
  for (const kind of [
    "failed",
    "warnings",
    "pending",
    "unknown",
    "passed",
    "skipped",
  ] as const)
    if (checks.some((check) => checkStatus(check) === kind)) return kind;
  return "unknown";
}
function score(checks: Check[]): number | undefined {
  if (
    !checks.length ||
    checks.some((check) => !check.category || !check.severity)
  )
    return undefined;
  let total = 0,
    passed = 0;
  for (const check of checks) {
    if (["skip", "pending"].includes(check.status) || check.category === "e2e")
      continue;
    const weight =
      ({ error: 3, warning: 2, info: 1 } as Record<string, number>)[
        check.severity!
      ] ?? 1;
    total += weight;
    if (checkStatus(check) === "passed") passed += weight;
  }
  return total ? Math.round((passed / total) * 100) : undefined;
}

/** Group publishing results using API categories, severity and remediation hints. */
export function formatChecklist(
  run: ChecklistRun,
  options: {
    serverName: string;
    dashboardUrl: string;
    color?: boolean;
    verbose?: boolean;
  }
): string {
  const paint = (value: string, code: number) =>
    options.color ? `\u001b[${code}m${value}\u001b[0m` : value;
  const icons: Record<CheckStatus, string> = {
    passed: paint("✓", 32),
    failed: paint("✗", 31),
    warnings: paint("!", 33),
    skipped: paint("–", 2),
    pending: paint("○", 33),
    unknown: "?",
  };
  const label =
    run.status === "pending"
      ? "queued"
      : ["canceled", "cancelled"].includes(run.status)
        ? "cancelled"
        : run.status;
  const duration = elapsed(run.startedAt, run.completedAt);
  const checks = run.checks ?? [];
  const points = score(checks);
  const lines = [
    `Checklist ${plain(label)}${duration ? ` in ${duration}` : ""}`,
    `${plain(options.serverName)}${run.gitBranch ? ` · ${plain(run.gitBranch)}` : ""} · All clients${points === undefined ? "" : ` · Score ${points}/100`}`,
  ];
  if (run.targetUrl) lines.push(`Checked ${plain(run.targetUrl)}`);
  if (run.errorMessage) lines.push("", prose(run.errorMessage));
  if (checks.length) {
    const policy = policyConcerns(checks);
    // Policy review is separate from the fixed publishing checks.
    lines.push("", counts(checks.filter((check) => !isPolicy(check))));
    if (policy.length)
      lines.push(
        paint(
          `${policy.length} policy concern${policy.length === 1 ? "" : "s"} may require additional review`,
          33
        )
      );
    const groups = new Map<string, Check[]>();
    for (const check of checks) {
      const category = check.category ?? "other";
      groups.set(category, [...(groups.get(category) ?? []), check]);
    }
    const order = [...Object.keys(categories), "other"];
    for (const [category, items] of [...groups].sort(
      ([a], [b]) =>
        (order.includes(a) ? order.indexOf(a) : 99) -
        (order.includes(b) ? order.indexOf(b) : 99)
    )) {
      lines.push(
        "",
        `${icons[groupStatus(items)]} ${plain(categories[category] ?? (category === "other" ? "Other checks" : category))}`,
        `  ${counts(items)}`
      );
      for (const check of items) {
        const kind = checkStatus(check);
        // Older API responses without categories retain individual check names.
        if (kind === "passed" && !options.verbose && check.category) continue;
        const clients = check.platforms?.map(
          (p) =>
            ({ chatgpt: "ChatGPT", claudeai: "Claude", claude: "Claude" })[p] ??
            p
        );
        lines.push(
          "",
          `  ${icons[kind]} ${plain(check.checkName || check.checkId || "Unnamed check")}${clients?.length ? ` [${plain(clients.join(", "))}]` : ""}`
        );
        if (check.message && (kind !== "passed" || options.verbose))
          lines.push(prose(check.message, "      "));
        if (["failed", "warnings"].includes(kind) && check.hint?.text)
          lines.push("", prose(`Fix: ${check.hint.text}`, "      "));
        if (options.verbose && kind !== "passed")
          for (const detail of check.details ?? [])
            lines.push(prose(`${detail.label}: ${detail.value}`, "      "));
      }
    }
  } else if (run.status === "completed")
    lines.push("", "No individual check results were returned.");
  const readiness: string[] = [];
  for (const [name, ready] of [
    ["ChatGPT", run.isReadyForChatgpt],
    ["Claude", run.isReadyForClaudeai],
  ] as const)
    if (typeof ready === "boolean")
      readiness.push(
        `${name.padEnd(10)}${ready ? paint("Ready", 32) : paint("Not ready", 33)}`
      );
  if (readiness.length) lines.push("", "Client Readiness", ...readiness);
  lines.push(
    "",
    fields([
      ["Run", run.id],
      ["Details", `mcp-use checklist get ${plain(run.id)} --verbose`],
      ["Dashboard", options.dashboardUrl],
    ])
  );
  return lines.join("\n");
}

/**
 * Whether a skipped check simply doesn't apply to this server, as Cloud
 * decides it: such a skip doesn't leave the run incomplete.
 */
function notApplicable(check: Check): boolean {
  return (
    check.status === "skip" &&
    ((check.checkId === "skills-over-mcp-readable" &&
      check.message ===
        "Server does not advertise the Skills over MCP extension") ||
      (["resource-metadata", "tool-metadata"].includes(check.category ?? "") &&
        check.message === "No view resources found — view checks skipped"))
  );
}

/** Findings contain server-supplied text. Render it as text, not HTML, links or mentions. */
function escapeText(value: string): string {
  return value
    .slice(0, 600)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/@/g, "&#64;")
    .replace(/\s+/g, " ");
}

const TABLE_CELL_ATTR = 'align="left" valign="top" style="vertical-align:top"';
/** Rows per findings table; the rest are counted. */
const MAX_ROWS = 10;
/** GitHub's limit on check output, which the app's report keeps under. */
const MAX_BYTES = 50_000;
/** Room for the commit line the action inserts after the heading. */
const COMMIT_RESERVE = 64;
const MORE_FINDINGS = "More findings in the checklist.";
const PROMPT_TRUNCATED =
  "The prompt is shortened to fit this report. Copy the full prompt from the dashboard, or read `fixPrompt` in the `--json` result.";

const PROMPT_OMITTED =
  "The prompt for AI agents doesn't fit in this report. Copy it from the dashboard, or read `fixPrompt` in the `--json` result.";

function bytes(blocks: readonly string[]): number {
  return Buffer.byteLength(blocks.join("\n\n"), "utf8");
}

/** The longest start of `value` that fits in `limit` UTF-8 bytes, without splitting a character. */
function clip(value: string, limit: number): string {
  return Buffer.from(value, "utf8")
    .subarray(0, Math.max(0, limit))
    .toString("utf8")
    .replace(/\uFFFD+$/, "");
}

/**
 * Render a run as GitHub-flavored Markdown in the Manufact GitHub app's
 * publishing-check format, for pull request comments and job summaries.
 * The first line is always `## Publishing checks`.
 */
export function formatChecklistMarkdown(
  run: ChecklistRun,
  options: { dashboardUrl: string }
): string {
  // Live tests don't count toward publishing readiness.
  const checks = (run.checks ?? []).filter((check) => check.category !== "e2e");
  const technical = checks.filter((check) => !isPolicy(check));
  const errors = technical.filter(
    (check) => check.status === "fail" && check.severity === "error"
  );
  const recommendations = technical.filter(
    (check) => check.status === "fail" && check.severity !== "error"
  );
  const policy = checks.filter(
    (check) =>
      isPolicy(check) &&
      check.checkId !== POLICY_SUMMARY &&
      check.status === "fail"
  );
  const policyComplete = checks.some(
    (check) => check.checkId === POLICY_SUMMARY && check.status === "pass"
  );
  const technicalComplete =
    technical.some((check) => ["pass", "fail"].includes(check.status)) &&
    !technical.some(
      (check) =>
        check.status === "pending" ||
        (check.status === "skip" &&
          check.severity === "error" &&
          !notApplicable(check))
    );

  const completed = run.status === "completed";
  let title: string;
  let ready = false;
  if (["canceled", "cancelled"].includes(run.status))
    title = "Publishing checks cancelled";
  else if (run.status === "pending") title = "Publishing checks queued";
  else if (run.status === "running") title = "Publishing checks running";
  else if (run.status === "not_ready") title = "Not ready to test";
  else if (run.status === "failed")
    title = "Publishing checks could not finish";
  else if (errors.length)
    title = `${errors.length} required ${errors.length === 1 ? "fix" : "fixes"} before submission`;
  else if (!technicalComplete) title = "Publishing checks incomplete";
  else if (policy.length) title = "Policy concerns need review";
  else if (!policyComplete)
    title = "Technical checks passed · policy review incomplete";
  else {
    title = "Ready to submit";
    ready = true;
  }

  const summary = [title];
  if (run.status === "not_ready") {
    summary.push(
      run.errorMessage ?? "The server is not ready for publishing checks."
    );
    summary.push(
      `[Authenticate or reconnect in Manufact](${options.dashboardUrl})`
    );
  }
  if (completed) {
    const assessed = checks.filter((check) =>
      ["pass", "fail"].includes(check.status)
    );
    summary.push(
      `${assessed.filter((check) => check.status === "pass").length} / ${assessed.length} checks passed. ${recommendations.length} recommendations.`
    );
    if (errors.length)
      summary.push(
        "Required errors block submission for the affected clients."
      );
    if (policy.length)
      summary.push(
        "Policy findings may lead to rejection or additional manual review; they are not a final store decision."
      );
    if (!policyComplete)
      summary.push(
        "Policy review was not completed. See the checklist for coverage and retry options."
      );
    if (ready)
      summary.push("Store approval remains subject to the store's review.");
  }

  const text = ["## Publishing checks", summary.join("\n\n")];
  // Everything before the dashboard link stays within this many bytes, so the
  // report with the action's commit line stays under GitHub's limit.
  const link = `[View dashboard](${options.dashboardUrl})`;
  const budget = MAX_BYTES - COMMIT_RESERVE - bytes(["", link]);
  let truncated = false;
  if (completed)
    for (const [label, rows] of [
      ["Required fixes", errors],
      ["Policy concerns", policy],
      ["Recommendations", recommendations],
    ] as const) {
      if (!rows.length || truncated) continue;
      const heading = `### ${label}`;
      const table = [
        "<table><thead><tr>",
        ...["Check", "Client", "Feedback"].map(
          (heading) => `<th ${TABLE_CELL_ATTR}>${heading}</th>`
        ),
        "</tr></thead><tbody>",
      ];
      let shown = 0;
      for (const row of rows.slice(0, MAX_ROWS)) {
        const clients = row.platforms?.length
          ? row.platforms
              .map((platform) =>
                platform === "chatgpt"
                  ? "ChatGPT / Codex"
                  : platform === "claudeai"
                    ? "Claude"
                    : platform
              )
              .join(", ")
          : "All clients";
        const feedback = [
          row.message ? escapeText(row.message) : null,
          row.hint?.text
            ? `<strong>Fix:</strong> ${escapeText(row.hint.text)}`
            : null,
        ]
          .filter(Boolean)
          .join("<br><br>");
        const line = `<tr><td ${TABLE_CELL_ATTR}><strong>${escapeText(row.checkName)}</strong></td><td ${TABLE_CELL_ATTR}>${escapeText(clients)}</td><td ${TABLE_CELL_ATTR}>${feedback || "See the checklist for details."}</td></tr>`;
        // Stop before a row that, with the notes that may follow it, would
        // push the report over the limit.
        const candidate = [
          ...text,
          heading,
          [...table, line, "</tbody></table>"].join(""),
          `${rows.length} more in the checklist.`,
          MORE_FINDINGS,
        ];
        if (bytes(candidate) > budget) {
          truncated = true;
          break;
        }
        table.push(line);
        shown++;
      }
      if (shown) {
        table.push("</tbody></table>");
        text.push(heading, table.join(""));
      }
      if (truncated) text.push(MORE_FINDINGS);
      else if (rows.length > MAX_ROWS)
        text.push(`${rows.length - MAX_ROWS} more in the checklist.`);
    }

  // Cloud's fix prompt, collapsed and copyable. GitHub renders a copy button
  // on the code block; the fence outgrows any backticks in the prompt. A
  // prompt that doesn't fit what's left is shortened, with a note.
  const prompt = run.fixPrompt?.trim();
  if (prompt) {
    const longest = Math.max(
      0,
      ...[...prompt.matchAll(/`+/g)].map((m) => m[0].length)
    );
    const fence = "`".repeat(Math.max(3, longest + 1));
    const block = (body: string, note?: string) =>
      [
        "<details><summary>Prompt for AI agents</summary>",
        "",
        `${fence}text`,
        body,
        fence,
        "",
        ...(note ? [note, ""] : []),
        "</details>",
      ].join("\n");
    const left = budget - bytes([...text, ""]);
    if (bytes([block(prompt)]) <= left) text.push(block(prompt));
    else {
      const room = left - bytes([block("", PROMPT_TRUNCATED)]);
      const clipped = clip(prompt, room).trimEnd();
      if (clipped) text.push(block(clipped, PROMPT_TRUNCATED));
      else if (bytes([PROMPT_OMITTED]) <= left) text.push(PROMPT_OMITTED);
    }
  }
  text.push(link);
  return text.join("\n\n");
}
