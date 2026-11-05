/** Format a deployment page for a terminal. */
export function formatDeploymentList(value: unknown): string {
  const items =
    isRecord(value) && Array.isArray(value["items"])
      ? value["items"].filter(isRecord)
      : [];
  if (items.length === 0) return "No deployments.";
  const rows = items.map((item) =>
    [
      shortId(field(item, "id")),
      field(item, "serverId") ?? "-",
      field(item, "status") ?? "-",
      field(item, "deploymentTrigger") ?? "-",
      field(item, "gitBranch") ?? "-",
      field(item, "createdAt") ?? "-",
      summarize(field(item, "error")),
    ].join("\t")
  );
  return [
    "DEPLOYMENT\tSERVER\tSTATUS\tTRIGGER\tBRANCH\tCREATED\tERROR",
    ...rows,
  ].join("\n");
}

/** Format one deployment and actionable log guidance. */
export function formatDeployment(value: unknown): string {
  if (!isRecord(value)) return String(value);
  const id = field(value, "id") ?? "-";
  const error = field(value, "error");
  return [
    `Deployment: ${id}`,
    `Server: ${field(value, "serverId") ?? "-"}`,
    `Status: ${field(value, "status") ?? "-"}`,
    `Trigger: ${field(value, "deploymentTrigger") ?? "-"}`,
    `Branch: ${field(value, "gitBranch") ?? "-"}`,
    `Created: ${field(value, "createdAt") ?? "-"}`,
    ...(error !== undefined
      ? [`Error: ${summarize(error)}`, `Build logs: mcp-use logs ${id} --build`]
      : []),
  ].join("\n");
}

function field(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const result = value[key];
  return typeof result === "string" && result !== "" ? result : undefined;
}

function shortId(value: string | undefined): string {
  return value === undefined ? "-" : value.slice(0, 8);
}

function summarize(value: string | undefined): string {
  if (value === undefined) return "-";
  const firstLine = value.split(/\r?\n/, 1)[0] ?? value;
  return firstLine.length > 100 ? `${firstLine.slice(0, 97)}...` : firstLine;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
