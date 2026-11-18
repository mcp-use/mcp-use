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

const CLIENTS: Record<string, string> = {
  chatgpt: "ChatGPT",
  claudeai: "Claude.ai",
  claude: "Claude.ai",
  "claude-code": "Claude Code",
  cursor: "Cursor",
};

/**
 * The dashboard's "Copy fix prompt" text: every check that didn't pass, with
 * its details and fix, plus the dashboard's reference links and instructions.
 */
export function formatFixPrompt(run: ChecklistRun): string | undefined {
  const issues = (run.checks ?? []).filter(
    (check) =>
      check.checkId !== POLICY_SUMMARY &&
      ["failed", "warnings"].includes(checkStatus(check))
  );
  if (!issues.length) return undefined;
  const lines = [
    `You are an MCP server developer. Your server${run.targetUrl ? ` at ${run.targetUrl}` : ""} has ${issues.length} issue(s) to fix before it will pass automated platform compatibility checks.`,
    "",
    "## Reference specifications",
    "- MCP specification, tools: https://modelcontextprotocol.io/specification/2026-07-28/server/tools",
    "- MCP specification, resources: https://modelcontextprotocol.io/specification/2026-07-28/server/resources",
    "- OpenAI Apps reference: https://developers.openai.com/plugins/reference",
    "",
    "## Issues to fix",
  ];
  for (const check of issues) {
    const severity =
      check.severity === "error" || check.severity === "warning"
        ? check.severity
        : checkStatus(check) === "failed"
          ? "error"
          : "warning";
    lines.push("", `### [${severity.toUpperCase()}] ${check.checkId}`);
    if (check.message) lines.push(check.message);
    if (check.details?.length)
      lines.push(
        "Affected:",
        ...check.details.map((d) => `- ${d.label}: ${d.value}`)
      );
    if (check.hint?.text) lines.push(`Fix: ${check.hint.text}`);
  }
  lines.push(
    "",
    "## Validation",
    "After applying fixes, run the project build (e.g. `npm run build`) and ensure TypeScript typechecking passes. Do not add fields that are not in the project's type definitions.",
    "",
    "## What to do",
    "For each issue above, locate the relevant code in your MCP server implementation and apply the fix described. Validate inputs with proper error messages, not raw schema validation errors."
  );
  return lines.join("\n");
}

/** Escape text for a Markdown table cell inside GitHub-flavored Markdown. */
function cell(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>");
}

/**
 * Render a run as GitHub-flavored Markdown laid out like the dashboard's
 * checklist page: score card, policy banner, then one section per category.
 */
export function formatChecklistMarkdown(
  run: ChecklistRun,
  options: { serverName: string; dashboardUrl: string }
): string {
  const checks = run.checks ?? [];
  const fixed = checks.filter((check) => !isPolicy(check));
  const concerns = policyConcerns(checks);
  const points = typeof run.score === "number" ? run.score : score(checks);
  const duration = elapsed(run.startedAt, run.completedAt);
  const lines: string[] = [
    `## Manufact Publishing Checks · ${cell(options.serverName)}`,
    "",
    `${run.gitBranch ? `Branch \`${run.gitBranch}\`` : "Production"}${duration ? ` · ${duration}` : ""}`,
    "",
  ];

  if (run.status !== "completed") {
    lines.push(
      `> [!CAUTION]`,
      `> **Checklist ${cell(run.status)}**${run.errorMessage ? `<br>${cell(run.errorMessage)}` : ""}`,
      ""
    );
  }

  // Score card: score on the left, last-run counts on the right.
  const tally: Record<CheckStatus, number> = {
    passed: 0,
    failed: 0,
    warnings: 0,
    skipped: 0,
    pending: 0,
    unknown: 0,
  };
  for (const check of fixed) tally[checkStatus(check)]++;
  const last = [
    tally.passed ? `✅ ${tally.passed} passed` : "",
    tally.failed ? `❌ ${tally.failed} failed` : "",
    tally.warnings
      ? `⚠️ ${tally.warnings} warning${tally.warnings === 1 ? "" : "s"}`
      : "",
    tally.skipped ? `➖ ${tally.skipped} skipped` : "",
    tally.pending ? `⏳ ${tally.pending} pending` : "",
    tally.unknown ? `❔ ${tally.unknown} unknown` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const ready = (value: boolean | null | undefined) =>
    value === true ? "✅ Ready" : value === false ? "❌ Not ready" : "—";
  lines.push(
    "| Checks score | Last run | ChatGPT / Codex | Claude |",
    "| :-- | :-- | :-- | :-- |",
    `| ${points === undefined ? "—" : `**${points}** /100`} | ${last || "No checks"} | ${ready(run.isReadyForChatgpt)} | ${ready(run.isReadyForClaudeai)} |`,
    ""
  );

  // Policy banner, as on the dashboard.
  if (concerns.length)
    lines.push(
      "> [!WARNING]",
      `> **May require additional review** · ${concerns.length} policy concern${concerns.length === 1 ? "" : "s"}<br>`,
      "> Policy findings may require additional review from store reviewers.",
      ""
    );

  // Collapsed, copyable fix prompt, as on the dashboard. GitHub renders a copy
  // button on the code block; the fence outgrows any backticks in the prompt.
  const prompt = formatFixPrompt(run);
  if (prompt) {
    const longest = Math.max(
      0,
      ...[...prompt.matchAll(/`+/g)].map((m) => m[0].length)
    );
    const fence = "`".repeat(Math.max(3, longest + 1));
    lines.push(
      "<details><summary>Prompt for AI agents</summary>",
      "",
      `${fence}text`,
      prompt,
      fence,
      "",
      "</details>",
      ""
    );
  }

  // One section per category, in dashboard order. Sections with issues start open.
  const groups = new Map<string, Check[]>();
  for (const check of checks) {
    const category = check.category ?? "other";
    groups.set(category, [...(groups.get(category) ?? []), check]);
  }
  const order = [...Object.keys(categories), "other"];
  const icon: Record<CheckStatus, string> = {
    passed: "✅",
    failed: "❌",
    warnings: "⚠️",
    skipped: "➖",
    pending: "⏳",
    unknown: "❔",
  };
  for (const [category, items] of [...groups].sort(
    ([a], [b]) =>
      (order.includes(a) ? order.indexOf(a) : 99) -
      (order.includes(b) ? order.indexOf(b) : 99)
  )) {
    const passed = items.filter((c) => checkStatus(c) === "passed").length;
    const counted = items.filter((c) => checkStatus(c) !== "skipped").length;
    const issues = items.some((c) =>
      ["failed", "warnings", "pending", "unknown"].includes(checkStatus(c))
    );
    const name =
      categories[category] ??
      (category === "other" ? "Other checks" : category);
    lines.push(
      `<details${issues ? " open" : ""}><summary><b>${cell(name)}</b> &nbsp; ${issues ? "❌ Issues" : "✅ Pass"} · ${passed}/${counted}</summary>`,
      ""
    );
    lines.push("| | Check |", "| :-: | :-- |");
    for (const check of items) {
      const kind = checkStatus(check);
      const open = ["failed", "warnings"].includes(kind);
      const tags: string[] = [];
      if (open) {
        const severity =
          check.severity === "error" || check.severity === "warning"
            ? check.severity
            : kind === "failed"
              ? "error"
              : "warning";
        tags.push(severity);
        for (const platform of check.platforms ?? [])
          tags.push(cell(CLIENTS[platform] ?? platform));
        const policyUrl = check.details?.find(
          (d) => d.label === "policy URL"
        )?.value;
        if (policyUrl && /^https:\/\//.test(policyUrl))
          tags.push(`[Policy text ↗](${policyUrl})`);
      }
      const mark = open && check.severity === "error" ? "🛑" : icon[kind];
      // Name, then severity · clients · policy link on one plain line, then
      // the message and fix, so rows don't need a narrow tags column.
      const body = [`**${cell(check.checkName || check.checkId)}**`];
      if (tags.length) body.push(tags.join(" · "));
      if (check.message) body.push(cell(check.message));
      if (open && check.hint?.text)
        body.push(`<b>How to fix:</b> ${cell(check.hint.text)}`);
      lines.push(`| ${mark} | ${body.join("<br>")} |`);
    }
    lines.push("", "</details>", "");
  }
  if (!checks.length && run.status === "completed")
    lines.push("No individual check results were returned.", "");

  lines.push(`[View in dashboard ↗](${options.dashboardUrl})`);
  return lines.join("\n");
}
