import { setTimeout } from "node:timers/promises";
import { CommandError } from "../../core/errors.js";
import type { Cloud } from "./types.js";

/**
 * Wait until Cloud reports a successful or failed terminal deployment.
 *
 * A source upload that creates a new commit also triggers Cloud's webhook
 * deployment for that commit, and Cloud stops the older of the two. When the
 * watched deployment is stopped and a newer deployment of the same server and
 * commit exists, the wait follows that deployment, whose id is returned.
 */
export async function waitForDeployment(
  cloud: Cloud,
  id: string
): Promise<{
  id: string;
  status: string;
  mcpUrl: string | null;
  gitBranch?: string | null;
  gitCommitSha?: string | null;
}> {
  const override = process.env["MCP_USE_POLL_INTERVAL_MS"];
  const interval =
    override !== undefined && /^\d+$/.test(override) ? Number(override) : 1000;
  const deadline = Date.now() + 30 * 60 * 1000;
  const followed = new Set<string>([id]);
  while (Date.now() < deadline) {
    const deployment = await cloud.call(
      cloud.client.GET("/api/v1/deployments/{id}", {
        params: { path: { id } },
      }),
      {
        timeout: {
          message: `Cloud timed out while checking deployment ${id}. The deployment may still be running.`,
          nextSteps: [
            {
              description: "Check deployment status",
              command: `mcp-use deployments get ${id} --json`,
            },
            {
              description: "Inspect build logs",
              command: `mcp-use logs ${id} --build --json`,
            },
          ],
        },
      }
    );
    if (deployment.status === "running")
      return {
        id,
        status: deployment.status,
        mcpUrl: deployment.mcpUrl,
        gitBranch: deployment.gitBranch,
        gitCommitSha: deployment.gitCommitSha,
      };
    if (deployment.status === "stopped") {
      const successor = await supersedingDeployment(cloud, deployment);
      if (successor !== undefined && !followed.has(successor)) {
        followed.add(successor);
        id = successor;
        continue;
      }
    }
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

/** The newest later deployment of the same server and commit, if any. */
async function supersedingDeployment(
  cloud: Cloud,
  stopped: {
    id: string;
    serverId: string;
    gitCommitSha: string | null;
    createdAt: string;
  }
): Promise<string | undefined> {
  if (!stopped.gitCommitSha) return undefined;
  const list = await cloud.call(
    cloud.client.GET("/api/v1/deployments", {
      params: { query: { serverId: stopped.serverId, limit: 10 } },
    })
  );
  const stoppedAt = Date.parse(stopped.createdAt);
  return list.items
    .filter(
      (item) =>
        item.id !== stopped.id &&
        item.gitCommitSha === stopped.gitCommitSha &&
        Date.parse(item.createdAt) > stoppedAt
    )
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]?.id;
}
