import { stripVTControlCharacters } from "node:util";
import type { ChecklistRun } from "./api.js";

type Status =
  | "passed"
  | "failed"
  | "warnings"
  | "skipped"
  | "pending"
  | "unknown";

function status(value: string): Status {
  switch (value.toLowerCase()) {
    case "pass":
    case "passed":
    case "success":
      return "passed";
    case "fail":
    case "failed":
    case "error":
      return "failed";
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

function text(value: string): string {
  return stripVTControlCharacters(value).replaceAll("\r", "");
}

function duration(run: ChecklistRun): string {
  if (!run.startedAt || !run.completedAt) return "";
  const milliseconds = Date.parse(run.completedAt) - Date.parse(run.startedAt);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "";
  const seconds = Math.round(milliseconds / 1000);
  return ` in ${seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`}`;
}

/** Human summary only; API readiness is authoritative, independent of check counts. */
export function formatChecklist(
  run: ChecklistRun,
  options: { serverName: string; dashboardUrl: string; color?: boolean }
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
  const lines = [
    `Checklist ${text(label)}${duration(run)}`,
    `${text(options.serverName)}${run.gitBranch ? ` · ${text(run.gitBranch)}` : ""}`,
  ];
  if (run.errorMessage) lines.push("", text(run.errorMessage));
  if (run.checks?.length) {
    const counts: Record<Status, number> = {
      passed: 0,
      failed: 0,
      warnings: 0,
      skipped: 0,
      pending: 0,
      unknown: 0,
    };
    lines.push("");
    for (const check of run.checks) {
      const kind = status(check.status);
      counts[kind]++;
      lines.push(
        `  ${icons[kind]} ${text(check.checkName || check.checkId || "Unnamed check")}`
      );
      if (kind !== "passed" && check.message) {
        lines.push(
          ...text(check.message)
            .trim()
            .split("\n")
            .map((line) => `      ${line}`)
        );
      }
    }
    lines.push(
      "",
      (Object.entries(counts) as [Status, number][])
        .filter(([, count]) => count > 0)
        .map(
          ([kind, count]) =>
            `${count} ${kind === "warnings" && count === 1 ? "warning" : kind}`
        )
        .join(" · ")
    );
  } else if (run.status === "completed") {
    lines.push("", "No individual check results were returned.");
  }
  const readiness: string[] = [];
  for (const [name, ready] of [
    ["ChatGPT", run.isReadyForChatgpt],
    ["Claude", run.isReadyForClaudeai],
  ] as const) {
    if (typeof ready === "boolean")
      readiness.push(
        `${name.padEnd(10)}${ready ? paint("Ready", 32) : paint("Not ready", 33)}`
      );
  }
  if (readiness.length) lines.push("", ...readiness);
  lines.push(
    "",
    `Run       ${text(run.id)}`,
    `Details   mcp-use checklist get ${text(run.id)}`,
    `Dashboard ${options.dashboardUrl}`
  );
  return lines.join("\n");
}
