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

const HELP = `Usage: mcp-use deployments <command> [options]

Manage cloud deployments and logs.

Commands:
  list                         List deployments
  get <deployment-id>          Show one deployment
  logs <deployment-id>         Read runtime or build logs
  restart <deployment-id>      Create a replacement deployment
  stop <deployment-id>         Stop a deployment
  delete <deployment-id>       Delete a deployment

Run mcp-use deployments <command> --help for all options.

Exit codes:
  0  Success or help
  2  Invalid arguments or confirmation required
  1  API or operational failure`;

const COMMAND_HELP: Record<string, string> = {
  list: `Usage: mcp-use deployments list [options]\n\nOptions:\n  --org <id-or-slug>  Override the active organization\n  --server <id>       Filter by server\n  --limit <n>         Results per page (default: 30; range: 1-100)\n  --skip <n>          Results to skip (default: 0)\n  --json              Emit the complete API page\n  -h, --help          Show this help`,
  get: `Usage: mcp-use deployments get <deployment-id> [--json]\n\nOptions:\n  --json      Emit the complete deployment object\n  -h, --help  Show this help`,
  logs: `Usage: mcp-use deployments logs <deployment-id> [options]\n\nOptions:\n  --build     Read build logs instead of runtime logs\n  --follow    Poll build logs until a terminal status\n  --json      Emit exactly one object; with --follow, emit only at completion\n  -h, --help  Show this help`,
  restart: `Usage: mcp-use deployments restart <deployment-id> [options]\n\nOptions:\n  --branch <name>  Override the source branch\n  --follow         Follow build logs after restart\n  --json           Emit exactly one object; with --follow, emit only at completion\n  -h, --help       Show this help`,
  stop: `Usage: mcp-use deployments stop <deployment-id> [options]\n\nOptions:\n  --yes       Confirm without prompting\n  --json      Emit the result; never prompt\n  -h, --help  Show this help`,
  delete: `Usage: mcp-use deployments delete <deployment-id> [options]\n\nOptions:\n  --yes       Confirm without prompting\n  --json      Emit the result; never prompt\n  -h, --help  Show this help`,
};

/** Run the `mcp-use deployments` command family. */
export async function runDeployments(argv: readonly string[]): Promise<number> {
  if (argv.some((token) => token === "--help" || token === "-h")) {
    process.stdout.write(`${COMMAND_HELP[argv[0] ?? ""] ?? HELP}\n`);
    return 0;
  }
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
  printResult(result, json, formatDeploymentList(result));
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
  printResult(deployment, json, formatDeployment(deployment));
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
  let status = "pending";
  let collectedLogs = "";
  const terminal = new Set(["running", "failed", "stopped"]);
  let keepPolling = true;
  while (keepPolling) {
    const response = await api.request<BuildLogs>(
      `/deployments/${encodeURIComponent(id)}/build-logs?offset=${offset}`
    );
    if (response.logs !== "") {
      collectedLogs += response.logs;
      if (!json) {
        process.stdout.write(
          response.logs.endsWith("\n") ? response.logs : `${response.logs}\n`
        );
      }
    }
    offset = response.offset;
    status = response.status;
    keepPolling = follow && !terminal.has(response.status);
    if (keepPolling) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  if (json) {
    printResult(
      { deploymentId: id, offset, logs: collectedLogs, status },
      true
    );
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

function formatDeploymentList(value: unknown): string {
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

function formatDeployment(value: unknown): string {
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
      ? [
          `Error: ${summarize(error)}`,
          `Build logs: mcp-use deployments logs ${id} --build`,
        ]
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
