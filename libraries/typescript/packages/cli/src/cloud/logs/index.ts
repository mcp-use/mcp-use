import { setTimeout as delay } from "node:timers/promises";

import {
  cloudFor,
  integer,
  parseCloudArgs,
  projectServer,
} from "../options.js";
import { runCommand } from "../../core/command.js";
import { UsageError } from "../../core/errors.js";

/** Read build or runtime logs, optionally following until interrupted or complete. */
export async function runLogs(argv: readonly string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(
      "Usage: mcp-use logs [deployment-id] [--server <id-or-slug>] [--build] [--since <duration>] [--limit <n>] [--follow] [--json]\n\n--since accepts durations such as 30s, 5m, 2h or 1d.\n--follow polls until interrupted; build logs stop when the deployment completes.\n"
    );
    return 0;
  }
  return runCommand(argv, async (output) => {
    const { values, positionals } = parseCloudArgs(
      argv,
      {
        build: { type: "boolean" },
        since: { type: "string" },
        limit: { type: "string" },
        follow: { type: "boolean" },
      },
      "mcp-use logs [deployment-id] [options]",
      0,
      1
    );
    const limit = integer(values.limit, "--limit", 1000, 1, 20000);
    const start = sinceDate(values.since ?? "1h");
    const deploymentId = positionals[0];
    const cloud = deploymentId ? await cloudFor(values) : undefined;
    const deployment =
      deploymentId && cloud
        ? await cloud.call(
            cloud.client.GET("/api/v1/deployments/{id}", {
              params: { path: { id: deploymentId } },
            }),
            { notFound: { code: "deployment_not_found" } }
          )
        : undefined;
    const project = deployment ? undefined : await projectServer(values);
    const connection = cloud ?? project!.cloud;
    const serverId = deployment?.serverId ?? project!.server;
    const targetDeployment =
      deploymentId ?? project?.details.activeDeploymentId ?? undefined;
    const all: { time: string; message: string }[] = [];
    const seen = new Set<string>();
    let cursor = start;
    const controller = new AbortController();
    const stop = () => controller.abort();
    if (values.follow) process.once("SIGINT", stop);
    try {
      for (;;) {
        const page = await connection.call(
          connection.client.GET("/api/v1/servers/{id}/logs", {
            params: {
              path: { id: serverId },
              query: {
                type: values.build ? "build" : "runtime",
                start: cursor,
                limit,
                order: "asc",
                ...(targetDeployment ? { deploymentId: targetDeployment } : {}),
              },
            },
          })
        );
        const fresh = page.logs.filter((line) => {
          const key = JSON.stringify(line);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        all.push(...fresh);
        if (values.follow && !output.json && fresh.length)
          process.stderr.write(
            fresh.map((line) => `${line.time}\t${line.message}`).join("\n") +
              "\n"
          );
        if (!values.follow || controller.signal.aborted) break;
        if (values.build && targetDeployment) {
          const current = await connection.call(
            connection.client.GET("/api/v1/deployments/{id}", {
              params: { path: { id: targetDeployment } },
            })
          );
          if (
            ["running", "failed", "stopped", "cancelled", "canceled"].includes(
              current.status
            )
          )
            break;
        }
        cursor = page.logs.at(-1)?.time ?? page.window.end;
        const interval = integer(
          process.env["MCP_USE_POLL_INTERVAL_MS"],
          "MCP_USE_POLL_INTERVAL_MS",
          1000
        );
        try {
          await delay(interval, undefined, { signal: controller.signal });
        } catch {
          if (!controller.signal.aborted)
            throw new Error("Log polling interrupted.");
        }
        if (controller.signal.aborted) break;
      }
    } finally {
      process.removeListener("SIGINT", stop);
    }
    const logs = all;
    output.result(
      { serverId, deploymentId: targetDeployment ?? null, logs },
      values.follow
        ? "Log follow complete."
        : logs.map((line) => `${line.time}\t${line.message}`).join("\n") ||
            "No logs."
    );
  });
}

function sinceDate(value: string): string {
  const match = /^(\d+)(s|m|h|d)$/.exec(value);
  if (!match)
    throw new UsageError(
      "--since must be a duration such as 30s, 5m, 2h or 1d."
    );
  const duration =
    Number(match[1]) *
    ({ s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2]!] ?? 0);
  if (!Number.isSafeInteger(duration) || duration <= 0)
    throw new UsageError("--since must be a positive duration.");
  return new Date(Date.now() - duration).toISOString();
}
