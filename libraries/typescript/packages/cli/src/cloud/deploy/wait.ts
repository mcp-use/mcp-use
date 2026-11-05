import { setTimeout } from "node:timers/promises";
import { CommandError } from "../../core/errors.js";
import type { Cloud } from "./types.js";

/** Wait until Cloud reports a successful or failed terminal deployment. */
export async function waitForDeployment(
  cloud: Cloud,
  id: string
): Promise<{ status: string; mcpUrl: string | null }> {
  const override = process.env["MCP_USE_POLL_INTERVAL_MS"];
  const interval =
    override !== undefined && /^\d+$/.test(override) ? Number(override) : 1000;
  const deadline = Date.now() + 30 * 60 * 1000;
  while (Date.now() < deadline) {
    const deployment = await cloud.call(
      cloud.client.GET("/api/v1/deployments/{id}", { params: { path: { id } } })
    );
    if (deployment.status === "running")
      return { status: deployment.status, mcpUrl: deployment.mcpUrl };
    if (
      ["failed", "stopped", "cancelled", "canceled", "deleted"].includes(
        deployment.status
      )
    ) {
      throw new CommandError(
        "deployment_failed",
        `Deployment ${id} ${deployment.status}.`,
        undefined,
        [
          {
            description: "Inspect build logs",
            command: `mcp-use logs ${id} --build --json`,
          },
        ]
      );
    }
    await setTimeout(interval);
  }
  throw new CommandError(
    "deployment_timeout",
    "Deployment is still pending after 30 minutes.",
    undefined,
    [
      {
        description: "Inspect deployment",
        command: `mcp-use deployments get ${id} --json`,
      },
    ]
  );
}
