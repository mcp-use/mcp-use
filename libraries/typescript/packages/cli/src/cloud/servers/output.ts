import { fields, plain, prose, record, table } from "../../core/format.js";

/** A server overview using the existing server response only. */
export function formatServer(value: unknown, organization?: string): string {
  const server = record(value),
    repo = record(server.connectedRepository);
  return [
    plain(server.name || server.slug || server.id),
    ...(server.description ? [prose(server.description)] : []),
    "",
    fields([
      ["Status", server.status],
      ["Organization", organization ?? server.organizationId],
      ["Branch", repo.productionBranch],
      ["Repository", repo.repoFullName],
      ["Region", server.region],
      ["MCP URL", server.mcpUrl],
      ["Deployment", server.activeDeploymentId],
      ["ID", server.id],
      ["Dashboard", server.dashboardUrl],
    ]),
  ].join("\n");
}

/** Keep server lists aligned, with useful empty-page guidance. */
export function formatServerList(items: unknown[], total: number): string {
  if (!items.length)
    return `No servers${total ? " on this page" : ""}.\nDeploy a project: mcp-use deploy`;
  return `${table(
    ["NAME", "STATUS", "ID"],
    items.map((value) => {
      const item = record(value);
      return [item.name || item.slug, item.status, item.id];
    })
  )}\n\n${items.length} shown · ${total} total`;
}
