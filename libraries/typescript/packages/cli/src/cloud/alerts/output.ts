import {
  date,
  fields,
  plain,
  prose,
  record,
  table,
} from "../../core/format.js";
import type { components, operations } from "../api/generated/types.gen.js";

type Rule =
  operations["getApiV1ServersByIdAlertsRulesByRuleId"]["responses"][200]["content"]["application/json"]["rule"];
type Condition = components["schemas"]["AlertRuleCondition0"];
const metrics: Record<string, string> = {
  "runtime.serving": "Serving runtime",
  "cpu.busyPercent": "CPU usage (%)",
  "cpu.stealPercent": "CPU steal (%)",
  "memory.usagePercent": "Memory usage (%)",
  "request.requests": "Requests",
  "request.errors": "Request errors",
  "request.errorPercent": "Request error rate (%)",
  "request.unreachablePercent": "Unreachable requests (%)",
  "deployment.failedCount": "Failed deployments",
  "tool.calls": "Tool calls",
  "tool.errors": "Tool errors",
  "tool.errorPercent": "Tool error rate (%)",
};
function condition(value: Condition, indent = "  "): string {
  if ("all" in value || "any" in value) {
    const children = "all" in value ? value.all : value.any;
    return `${indent}${"all" in value ? "All" : "Any"} of:\n${children.map((child) => condition(child, `${indent}  `)).join("\n")}`;
  }
  const op = {
    gt: "is greater than",
    gte: "is at least",
    lt: "is less than",
    lte: "is at most",
    eq: "equals",
    ne: "does not equal",
  }[value.op];
  return prose(
    `${metrics[value.metric] ?? value.metric} ${op} ${value.value}`,
    indent
  );
}
function hold(value: string): string {
  return /^(?:0+(?:\.0+)?(?:ms|s|m|h|d))+$/.test(value)
    ? "No minimum duration"
    : `For ${value}`;
}
function state(value: unknown): string {
  const name = typeof value === "string" ? value : "unknown";
  return (
    (
      {
        active: "Firing",
        resolved: "Resolved",
        recovering: "Recovering",
        paused: "Paused",
        unknown: "Unknown",
      } as Record<string, string>
    )[name] ?? plain(name)
  );
}
function delivery(rule: Rule): string {
  return (
    rule.config.notify
      .map((target) =>
        target.type === "slack"
          ? `Slack${target.channel ? ` (${plain(target.channel)})` : ""}`
          : `Email${target.recipients?.length ? ` (${target.recipients.map(plain).join(", ")})` : ""}`
      )
      .join(", ") || "None"
  );
}
function activity(value: unknown): {
  count?: number;
  days?: number;
  last?: string | undefined;
} {
  const item = record(value);
  const daily = Array.isArray(item.triggers) ? item.triggers.map(record) : [];
  const valid =
    daily.length > 0 &&
    daily.every(
      (day) =>
        typeof day.day === "string" &&
        typeof day.count === "number" &&
        Number.isFinite(day.count) &&
        day.count >= 0
    );
  return {
    ...(valid
      ? {
          count: daily.reduce((sum, day) => sum + Number(day.count), 0),
          days: daily.length,
        }
      : {}),
    last: date(item.lastTriggered),
  };
}

/** Describe a rule without conflating its enabled setting with its firing state. */
export function formatAlert(
  rule: Rule,
  serverName: string,
  dashboardUrl: string
): string {
  const meta = record(rule);
  const stats = activity(rule);
  const lines = [plain(rule.config.name), plain(serverName)];
  if (rule.config.description) lines.push("", prose(rule.config.description));
  lines.push(
    "",
    fields([
      ["Rule", rule.config.enabled ? "Enabled" : "Paused"],
      [
        "Current state",
        meta.status === undefined ? undefined : state(meta.status),
      ],
      ["Delivery", delivery(rule)],
    ]),
    "",
    "Trigger",
    condition(rule.config.trigger.when),
    `  ${plain(hold(rule.config.trigger.for))}`,
    "",
    "Recovery",
    condition(rule.config.recover.when),
    `  ${plain(hold(rule.config.recover.for))}`
  );
  if (stats.count !== undefined || stats.last)
    lines.push(
      "",
      "Activity",
      fields([
        [
          "  Triggers",
          stats.count === undefined
            ? undefined
            : `${stats.count} in the past ${stats.days} days`,
        ],
        ["  Last triggered", stats.last],
      ])
    );
  lines.push(
    "",
    fields([
      ["ID", rule.id],
      ["Revision", rule.revision],
      ["Dashboard", dashboardUrl],
    ])
  );
  return lines.join("\n");
}

/** List rule state, delivery and activity already returned by the list request. */
export function formatAlertList(
  rules: Array<Rule & { status: string }>,
  total: number,
  serverName: string
): string {
  if (!rules.length)
    return `Alerts · ${plain(serverName)}\n\nNo alert rules${total ? " on this page" : ""}.\nCreate one: mcp-use alerts create --file <rule.yaml>`;
  return [
    `Alerts · ${plain(serverName)}`,
    "",
    table(
      ["NAME", "RULE", "STATE", "DELIVERY", "TRIGGERS", "ID"],
      rules.map((rule) => {
        const stats = activity(rule);
        return [
          rule.config.name,
          rule.config.enabled ? "Enabled" : "Paused",
          state(rule.status),
          delivery(rule),
          stats.count === undefined ? "—" : `${stats.count} / ${stats.days}d`,
          rule.id,
        ];
      })
    ),
    "",
    `${rules.length} shown · ${total} total`,
  ].join("\n");
}
