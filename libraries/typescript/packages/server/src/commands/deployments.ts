import { parseArgs } from "node:util";

import { cloudApiForOrganization, type CloudApi } from "./cloud-api.js";
import {
  confirm,
  printResult,
  reportError,
  UsageError,
  wantsJson,
} from "./shared.js";

interface Deployment {
  id: string;
  status: string;
  serverId?: string | null;
  gitBranch?: string | null;
}

interface BuildLogs {
  logs: string;
  offset: number;
  totalLength: number;
  status: string;
}

/** Run the `mcp-use deployments` command family. */
export async function runDeployments(argv: readonly string[]): Promise<number> {
  const json = wantsJson(argv);
  try {
    const subcommand = argv[0];
    if (subcommand === "list") return await list(argv.slice(1), json);
    if (subcommand === "get") return await get(argv.slice(1), json);
    if (subcommand === "logs") return await logs(argv.slice(1), json);
    if (subcommand === "restart") return await restart(argv.slice(1), json);
    if (subcommand === "stop") return await stop(argv.slice(1), json);
    if (subcommand === "delete") return await remove(argv.slice(1), json);
    throw new UsageError(
      "Usage: mcp-use deployments <list|get|logs|restart|stop|delete>"
    );
  } catch (error) {
    return reportError(
      error instanceof TypeError ? new UsageError(error.message) : error,
      json
    );
  }
}

async function list(argv: readonly string[], json: boolean): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    allowPositionals: false,
    strict: true,
    options: {
      org: { type: "string" },
      server: { type: "string" },
      limit: { type: "string", default: "30" },
      skip: { type: "string", default: "0" },
      json: { type: "boolean" },
    },
  });
  const limit = boundedInteger(values.limit, "--limit", 1, 100);
  const skip = boundedInteger(values.skip, "--skip", 0);
  const query = new URLSearchParams({
    limit: String(limit),
    skip: String(skip),
    ...(values.server !== undefined ? { serverId: values.server } : {}),
  });
  const { api } = await cloudApiForOrganization(values.org);
  const result = await api.request<unknown>(`/deployments?${query}`);
  printResult(result, json);
  return 0;
}

async function get(argv: readonly string[], json: boolean): Promise<number> {
  const { positionals } = parseSimple(argv, {
    json: { type: "boolean" as const },
  });
  const id = one(positionals, "mcp-use deployments get <deployment-id>");
  const { api } = await cloudApiForOrganization();
  const deployment = await api.request<Deployment>(
    `/deployments/${encodeURIComponent(id)}`
  );
  printResult(deployment, json);
  return 0;
}

async function logs(argv: readonly string[], json: boolean): Promise<number> {
  const { values, positionals } = parseSimple(argv, {
    build: { type: "boolean" as const },
    follow: { type: "boolean" as const },
    json: { type: "boolean" as const },
  });
  const id = one(positionals, "mcp-use deployments logs <deployment-id>");
  const { api } = await cloudApiForOrganization();
  if (values.build === true) {
    await streamBuildLogs(api, id, values.follow === true, json);
  } else {
    const response = await api.request<{ logs: string }>(
      `/deployments/${encodeURIComponent(id)}/logs?lines=500`
    );
    if (json) {
      printResult({ deploymentId: id, logs: response.logs }, true);
    } else {
      process.stdout.write(
        response.logs.endsWith("\n") ? response.logs : `${response.logs}\n`
      );
    }
  }
  return 0;
}

async function restart(
  argv: readonly string[],
  json: boolean
): Promise<number> {
  const { values, positionals } = parseSimple(argv, {
    branch: { type: "string" as const },
    follow: { type: "boolean" as const },
    json: { type: "boolean" as const },
  });
  const id = one(positionals, "mcp-use deployments restart <deployment-id>");
  const { api } = await cloudApiForOrganization();
  const current = await api.request<Deployment>(
    `/deployments/${encodeURIComponent(id)}`
  );
  if (current.serverId === undefined || current.serverId === null) {
    throw new UsageError(`Deployment ${id} is not attached to a server.`);
  }
  const created = await api.request<{ id: string }>("/deployments", {
    method: "POST",
    body: JSON.stringify({
      serverId: current.serverId,
      branch: values.branch ?? current.gitBranch ?? undefined,
      trigger: "redeploy",
    }),
  });
  if (values.follow === true) {
    await streamBuildLogs(api, created.id, true, json);
  } else {
    printResult(created, json, `Restarted as deployment ${created.id}.`);
  }
  return 0;
}

async function stop(argv: readonly string[], json: boolean): Promise<number> {
  return destructive(argv, json, "stop");
}

async function remove(argv: readonly string[], json: boolean): Promise<number> {
  return destructive(argv, json, "delete");
}

async function destructive(
  argv: readonly string[],
  json: boolean,
  operation: "stop" | "delete"
): Promise<number> {
  const { values, positionals } = parseSimple(argv, {
    yes: { type: "boolean" as const },
    json: { type: "boolean" as const },
  });
  const id = one(
    positionals,
    `mcp-use deployments ${operation} <deployment-id>`
  );
  if (
    !(await confirm(
      `${operation === "stop" ? "Stop" : "Delete"} deployment ${id}?`,
      {
        yes: values.yes === true,
        json,
      }
    ))
  ) {
    return 0;
  }
  const { api } = await cloudApiForOrganization();
  await api.request(
    `/deployments/${encodeURIComponent(id)}${operation === "stop" ? "/stop" : ""}`,
    { method: operation === "stop" ? "POST" : "DELETE" }
  );
  printResult(
    { [operation === "stop" ? "stopped" : "deleted"]: id },
    json,
    `${operation === "stop" ? "Stopped" : "Deleted"} ${id}.`
  );
  return 0;
}

async function streamBuildLogs(
  api: CloudApi,
  id: string,
  follow: boolean,
  json: boolean
): Promise<void> {
  let offset = 0;
  const terminal = new Set(["running", "failed", "stopped"]);
  let keepPolling = true;
  while (keepPolling) {
    const response = await api.request<BuildLogs>(
      `/deployments/${encodeURIComponent(id)}/build-logs?offset=${offset}`
    );
    if (response.logs !== "") {
      if (json) {
        process.stdout.write(
          `${JSON.stringify({ deploymentId: id, offset, logs: response.logs, status: response.status })}\n`
        );
      } else {
        process.stdout.write(
          response.logs.endsWith("\n") ? response.logs : `${response.logs}\n`
        );
      }
    }
    offset = response.offset;
    keepPolling = follow && !terminal.has(response.status);
    if (keepPolling) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
}

function parseSimple<T extends Record<string, { type: "string" | "boolean" }>>(
  argv: readonly string[],
  options: T
) {
  return parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options,
  });
}

function one(positionals: string[], usage: string): string {
  if (positionals.length !== 1) throw new UsageError(`Usage: ${usage}`);
  return positionals[0]!;
}

function boundedInteger(
  raw: string | undefined,
  name: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER
): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new UsageError(
      `${name} must be an integer from ${minimum} to ${maximum}.`
    );
  }
  return value;
}
