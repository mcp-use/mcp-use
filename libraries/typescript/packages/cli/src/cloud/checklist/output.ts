import { elapsed, fields, plain, prose } from "../../core/format.js";
import type { ChecklistRun } from "./api.js";

type Check = NonNullable<ChecklistRun["checks"]>[number];
type Status =
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
function status(check: Check): Status {
  switch (check.status.toLowerCase()) {
    case "pass":
    case "passed":
    case "success":
      return "passed";
    case "fail":
    case "failed":
    case "error":
      return check.severity === "warning" || check.severity === "info"
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
  const totals: Record<Status, number> = {
    passed: 0,
    failed: 0,
    warnings: 0,
    skipped: 0,
    pending: 0,
    unknown: 0,
  };
  for (const check of checks) totals[status(check)]++;
  return (Object.entries(totals) as [Status, number][])
    .filter(([, count]) => count)
    .map(
      ([kind, count]) =>
        `${count} ${kind === "warnings" && count === 1 ? "warning" : kind}`
    )
    .join(" · ");
}
function groupStatus(checks: Check[]): Status {
  for (const kind of [
    "failed",
    "warnings",
    "pending",
    "unknown",
    "passed",
    "skipped",
  ] as const)
    if (checks.some((check) => status(check) === kind)) return kind;
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
    if (status(check) === "passed") passed += weight;
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
  const icons: Record<Status, string> = {
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
    const policy = checks.filter(
      (check) =>
        check.category === "policy-conformance" &&
        ["failed", "warnings"].includes(status(check))
    );
    // Dynamic policy concerns are separate from the fixed publishing checks.
    lines.push("", counts(checks.filter((check) => !policy.includes(check))));
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
        const kind = status(check);
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
