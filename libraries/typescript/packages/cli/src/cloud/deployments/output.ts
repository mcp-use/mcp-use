import {
  age,
  date,
  elapsed,
  fields,
  plain,
  record,
  table,
} from "../../core/format.js";

/** Format deployment history with source, measured build duration and full IDs. */
export function formatDeploymentList(value: unknown): string {
  const page = record(value);
  const items = Array.isArray(page.items) ? page.items.map(record) : [];
  if (!items.length)
    return "No deployments on this page.\nDeploy a project: mcp-use deploy";
  return [
    "Deployments",
    "",
    table(
      ["STATUS", "TRAFFIC", "BRANCH", "COMMIT", "BUILD", "CREATED", "ID"],
      items.map((item) => [
        item.status,
        environment(item.isProductionDeployment),
        item.gitBranch,
        typeof item.gitCommitSha === "string"
          ? item.gitCommitSha.slice(0, 7)
          : undefined,
        elapsed(item.buildStartedAt, item.buildCompletedAt),
        age(item.createdAt),
        item.id,
      ])
    ),
    ...items
      .filter((item) => item.error)
      .map(
        (item) => `\n${plain(item.id)}: ${plain(item.error).split("\n")[0]}`
      ),
    "",
    `${items.length} shown${typeof page.total === "number" ? ` · ${page.total} total` : ""}`,
  ].join("\n");
}
function environment(value: unknown): string | undefined {
  return value === true ? "Production" : undefined;
}

/** One deployment, its source, URL, duration and actionable log guidance. */
export function formatDeployment(value: unknown): string {
  const item = record(value);
  const source = [
    item.gitBranch,
    typeof item.gitCommitSha === "string"
      ? item.gitCommitSha.slice(0, 7)
      : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  return [
    `Deployment ${plain(item.status ?? "unknown")}`,
    "",
    fields([
      ["ID", item.id],
      ["Server", item.serverId],
      ["Traffic", environment(item.isProductionDeployment)],
      ["Source", source],
      ["Commit", item.gitCommitMessage],
      ["Trigger", item.deploymentTrigger],
      ["Build", elapsed(item.buildStartedAt, item.buildCompletedAt)],
      ["Created", date(item.createdAt)],
      ["MCP URL", item.mcpUrl],
    ]),
    ...(item.error
      ? [
          "",
          `Error: ${plain(item.error).split("\n")[0]}`,
          `Build logs: mcp-use logs ${plain(item.id)} --build`,
        ]
      : []),
  ].join("\n");
}

/** A deploy receipt uses only metadata returned by the final polling response. */
export function formatDeployReceipt(value: unknown, duration?: string): string {
  const item = record(value);
  return [
    `${item.status === "running" ? "✓ Deployment running" : `Deployment ${plain(item.status)}`}${duration ? ` in ${duration}` : ""}`,
    "",
    fields([
      [
        "Source",
        [
          item.gitBranch,
          typeof item.gitCommitSha === "string"
            ? item.gitCommitSha.slice(0, 7)
            : undefined,
        ]
          .filter(Boolean)
          .join(" · "),
      ],
      ["MCP URL", item.mcpUrl],
      ["Deployment", item.deploymentId],
      ["Server", item.serverId],
      ["Dashboard", item.dashboardUrl],
    ]),
  ].join("\n");
}
