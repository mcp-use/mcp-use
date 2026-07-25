import { parseArgs } from "node:util";

import { cloudApiForOrganization, type CloudApi } from "./cloud-api.js";
import {
  confirm,
  printResult,
  reportError,
  UsageError,
  wantsJson,
} from "./shared.js";

interface EnvVariable {
  id: string;
  key: string;
  branch?: string | null;
  environments?: string[];
  sensitive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

const HELP = `Usage: mcp-use servers <command> [options]

Manage cloud servers and environment variables.

Commands:
  list                         List servers
  get <id-or-slug>             Show one server
  update <id-or-slug>          Update server metadata or build configuration
  delete <id-or-slug>          Delete a server
  env list <server>            List environment variable metadata
  env set <server> <KEY=VALUE> Create or update an environment variable
  env unset <server> <key>     Delete an environment variable

Run mcp-use servers <command> --help for all options.

Global options:
  --org <id-or-slug>  Override the active organization
  --json              Emit one machine-readable result or error
  -h, --help          Show help

Exit codes:
  0  Success or help
  2  Invalid arguments or confirmation required
  1  API or operational failure`;

const COMMAND_HELP: Record<string, string> = {
  list: `Usage: mcp-use servers list [options]\n\nOptions:\n  --org <id-or-slug>  Override the active organization\n  --limit <n>         Results per page (default: 30; range: 1-100)\n  --skip <n>          Results to skip (default: 0)\n  --json              Emit the complete API page\n  -h, --help          Show this help`,
  get: `Usage: mcp-use servers get <id-or-slug> [options]\n\nOptions:\n  --org <id-or-slug>  Override the active organization\n  --json              Emit the complete server object\n  -h, --help          Show this help`,
  update: `Usage: mcp-use servers update <id-or-slug> [options]\n\nOptions:\n  --org <id-or-slug>       Override the active organization\n  --name <name>            Set the display name\n  --description <text>     Set the description\n  --branch <name>          Set the production branch\n  --root-dir <path>        Set the repository root; pass an empty value to clear\n  --build-command <cmd>    Set the build command; pass an empty value to clear\n  --start-command <cmd>    Set the start command; pass an empty value to clear\n  --watch-paths <glob>     Set GitHub path filters; repeatable, empty clears\n  --deploy-branches <glob> Set branch filters; repeatable, empty clears\n  --wait-for-ci            Wait for other GitHub checks before auto-deploy\n  --no-wait-for-ci         Disable waiting for other GitHub checks\n  --json                   Emit the updated server\n  -h, --help               Show this help\n\n--wait-for-ci and --no-wait-for-ci are mutually exclusive.`,
  delete: `Usage: mcp-use servers delete <id-or-slug> [options]\n\nOptions:\n  --org <id-or-slug>  Override the active organization\n  --yes               Confirm deletion without prompting\n  --json              Emit the deletion result; never prompt\n  -h, --help          Show this help`,
  env: `Usage: mcp-use servers env <list|set|unset> [options]\n\nCommands:\n  list <server>             List keys and metadata; values are never returned\n  set <server> <KEY=VALUE> Create or update a value\n  unset <server> <key>     Delete a value\n\nRun mcp-use servers env <command> --help for all options.`,
  "env list": `Usage: mcp-use servers env list <server> [options]\n\nOptions:\n  --org <id-or-slug>  Override the active organization\n  --branch <name>     Select preview variables for a branch\n  --json              Emit metadata only; never values\n  -h, --help          Show this help`,
  "env set": `Usage: mcp-use servers env set <server> <KEY=VALUE> [options]\n\nOptions:\n  --org <id-or-slug>  Override the active organization\n  --branch <name>     Set a preview value for a branch (default: production)\n  --secret            Mark the value sensitive\n  --json              Emit mutation metadata only; never the value\n  -h, --help          Show this help`,
  "env unset": `Usage: mcp-use servers env unset <server> <key> [options]\n\nOptions:\n  --org <id-or-slug>  Override the active organization\n  --branch <name>     Delete a preview value for a branch\n  --yes               Confirm deletion without prompting\n  --json              Emit the deletion result; never prompt\n  -h, --help          Show this help`,
};

/** Run the `mcp-use servers` command family. */
export async function runServers(argv: readonly string[]): Promise<number> {
  if (argv.some((token) => token === "--help" || token === "-h")) {
    const key =
      argv[0] === "env" && argv[1] !== undefined
        ? `env ${argv[1]}`
        : (argv[0] ?? "");
    process.stdout.write(`${COMMAND_HELP[key] ?? HELP}\n`);
    return 0;
  }
  const json = wantsJson(argv);
  try {
    const subcommand = argv[0];
    if (subcommand === "list") return await list(argv.slice(1), json);
    if (subcommand === "get") return await get(argv.slice(1), json);
    if (subcommand === "update") return await update(argv.slice(1), json);
    if (subcommand === "delete") return await remove(argv.slice(1), json);
    if (subcommand === "env") return await env(argv.slice(1), json);
    throw new UsageError("Usage: mcp-use servers <list|get|update|delete|env>");
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
    options: commonListOptions(),
  });
  const { api, organizationId } = await cloudApiForOrganization(values.org);
  const { limit, skip } = parsePagination(values.limit, values.skip);
  const query = new URLSearchParams({
    organizationId,
    limit: String(limit),
    skip: String(skip),
  });
  const result = await api.request<unknown>(`/servers?${query}`);
  printResult(result, json, formatServerList(result));
  return 0;
}

async function get(argv: readonly string[], json: boolean): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: commonOrgJsonOptions(),
  });
  const server = exactlyOne(positionals, "mcp-use servers get <id-or-slug>");
  const { api } = await cloudApiForOrganization(values.org);
  const result = await api.request<unknown>(
    `/servers/${encodeURIComponent(server)}`
  );
  printResult(result, json, formatServer(result));
  return 0;
}

async function update(argv: readonly string[], json: boolean): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      ...commonOrgJsonOptions(),
      name: { type: "string" },
      description: { type: "string" },
      branch: { type: "string" },
      "root-dir": { type: "string" },
      "build-command": { type: "string" },
      "start-command": { type: "string" },
      "watch-paths": { type: "string", multiple: true },
      "deploy-branches": { type: "string", multiple: true },
      "wait-for-ci": { type: "boolean" },
      "no-wait-for-ci": { type: "boolean" },
    },
  });
  const server = exactlyOne(positionals, "mcp-use servers update <id-or-slug>");
  const config = {
    ...(values["root-dir"] !== undefined
      ? { rootDir: values["root-dir"] || null }
      : {}),
    ...(values["build-command"] !== undefined
      ? { buildCommand: values["build-command"] || null }
      : {}),
    ...(values["start-command"] !== undefined
      ? { startCommand: values["start-command"] || null }
      : {}),
  };
  if (values["wait-for-ci"] === true && values["no-wait-for-ci"] === true) {
    throw new UsageError(
      "--wait-for-ci and --no-wait-for-ci cannot be used together."
    );
  }
  const body = {
    ...(values.name !== undefined ? { name: values.name } : {}),
    ...(values.description !== undefined
      ? { description: values.description }
      : {}),
    ...(values.branch !== undefined ? { productionBranch: values.branch } : {}),
    ...(values["watch-paths"] !== undefined
      ? {
          watchPaths: normalizePatterns(
            values["watch-paths"],
            "--watch-paths",
            512
          ),
        }
      : {}),
    ...(values["deploy-branches"] !== undefined
      ? {
          deployBranchPatterns: normalizePatterns(
            values["deploy-branches"],
            "--deploy-branches",
            255
          ),
        }
      : {}),
    ...(values["wait-for-ci"] === true ? { waitForCi: true } : {}),
    ...(values["no-wait-for-ci"] === true ? { waitForCi: false } : {}),
    ...(Object.keys(config).length > 0 ? { config } : {}),
  };
  if (Object.keys(body).length === 0) {
    throw new UsageError(
      "servers update requires at least one mutation option."
    );
  }
  const { api } = await cloudApiForOrganization(values.org);
  const result = await api.request<unknown>(
    `/servers/${encodeURIComponent(server)}`,
    { method: "PATCH", body: JSON.stringify(body) }
  );
  printResult(result, json, `Updated ${server}.`);
  return 0;
}

async function remove(argv: readonly string[], json: boolean): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      ...commonOrgJsonOptions(),
      yes: { type: "boolean" },
    },
  });
  const server = exactlyOne(positionals, "mcp-use servers delete <id-or-slug>");
  if (
    !(await confirm(`Delete server ${server}?`, {
      yes: values.yes === true,
      json,
    }))
  ) {
    return 0;
  }
  const { api } = await cloudApiForOrganization(values.org);
  await api.request(`/servers/${encodeURIComponent(server)}`, {
    method: "DELETE",
  });
  printResult({ deleted: server }, json, `Deleted ${server}.`);
  return 0;
}

async function env(argv: readonly string[], json: boolean): Promise<number> {
  const operation = argv[0];
  if (operation === "list") return envList(argv.slice(1), json);
  if (operation === "set") return envSet(argv.slice(1), json);
  if (operation === "unset") return envUnset(argv.slice(1), json);
  throw new UsageError("Usage: mcp-use servers env <list|set|unset>");
}

async function envList(
  argv: readonly string[],
  json: boolean
): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      ...commonOrgJsonOptions(),
      branch: { type: "string" },
    },
  });
  const server = exactlyOne(positionals, "mcp-use servers env list <server>");
  const { api } = await cloudApiForOrganization(values.org);
  const variables = await listVariables(api, server, values.branch);
  const safe = variables.map((variable) => ({
    id: variable.id,
    key: variable.key,
    branch: variable.branch ?? null,
    environments: variable.environments ?? [],
    sensitive: variable.sensitive === true,
    createdAt: variable.createdAt,
    updatedAt: variable.updatedAt,
  }));
  printResult(
    safe,
    json,
    safe.map((variable) => variable.key).join("\n") ||
      "No environment variables."
  );
  return 0;
}

async function envSet(argv: readonly string[], json: boolean): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      ...commonOrgJsonOptions(),
      branch: { type: "string" },
      secret: { type: "boolean" },
    },
  });
  if (positionals.length !== 2) {
    throw new UsageError("Usage: mcp-use servers env set <server> <KEY=VALUE>");
  }
  const [server, assignment] = positionals as [string, string];
  const separator = assignment.indexOf("=");
  if (separator <= 0)
    throw new UsageError("Environment value must be KEY=VALUE.");
  const key = assignment.slice(0, separator);
  const value = assignment.slice(separator + 1);
  const { api } = await cloudApiForOrganization(values.org);
  const variables = await listVariables(api, server, values.branch);
  const existing = variables.find(
    (variable) =>
      variable.key === key && (variable.branch ?? undefined) === values.branch
  );
  const body = {
    key,
    value,
    branch: values.branch ?? null,
    environments: values.branch === undefined ? ["production"] : ["preview"],
    sensitive: values.secret === true,
  };
  if (existing === undefined) {
    await api.request<unknown>(
      `/servers/${encodeURIComponent(server)}/env-variables`,
      { method: "POST", body: JSON.stringify(body) }
    );
  } else {
    await api.request<unknown>(
      `/servers/${encodeURIComponent(server)}/env-variables/${encodeURIComponent(existing.id)}`,
      { method: "PATCH", body: JSON.stringify(body) }
    );
  }
  const result = {
    serverId: server,
    key,
    scope: values.branch === undefined ? "production" : "preview",
    branch: values.branch ?? null,
    secret: values.secret === true,
    updated: existing !== undefined,
  };
  printResult(result, json, `Set ${key}.`);
  return 0;
}

async function envUnset(
  argv: readonly string[],
  json: boolean
): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      ...commonOrgJsonOptions(),
      branch: { type: "string" },
      yes: { type: "boolean" },
    },
  });
  if (positionals.length !== 2) {
    throw new UsageError("Usage: mcp-use servers env unset <server> <key>");
  }
  const [server, key] = positionals as [string, string];
  if (
    !(await confirm(`Delete environment variable ${key}?`, {
      yes: values.yes === true,
      json,
    }))
  ) {
    return 0;
  }
  const { api } = await cloudApiForOrganization(values.org);
  const variables = await listVariables(api, server, values.branch);
  const existing = variables.find(
    (variable) =>
      variable.key === key && (variable.branch ?? undefined) === values.branch
  );
  if (existing !== undefined) {
    await api.request(
      `/servers/${encodeURIComponent(server)}/env-variables/${encodeURIComponent(existing.id)}`,
      { method: "DELETE" }
    );
  }
  printResult({ deleted: key }, json, `Deleted ${key}.`);
  return 0;
}

async function listVariables(
  api: CloudApi,
  server: string,
  branch?: string
): Promise<EnvVariable[]> {
  const query =
    branch === undefined ? "" : `?branch=${encodeURIComponent(branch)}`;
  return api.request<EnvVariable[]>(
    `/servers/${encodeURIComponent(server)}/env-variables${query}`
  );
}

function commonOrgJsonOptions() {
  return {
    org: { type: "string" as const },
    json: { type: "boolean" as const },
  };
}

function formatServerList(value: unknown): string {
  const items = arrayField(value, "items");
  if (items.length === 0) return "No servers.";
  const rows = items.map((item) => {
    const repository = objectField(item, "connectedRepository");
    const source =
      booleanField(repository, "isManaged") === true
        ? "managed"
        : repository !== undefined
          ? "github"
          : stringField(item, "externalUrl") !== undefined
            ? "external"
            : "-";
    return [
      stringField(item, "name") ?? stringField(item, "slug") ?? "-",
      stringField(item, "status") ??
        stringField(item, "latestDeploymentStatus") ??
        "-",
      source,
      stringField(item, "region") ?? "AUTO",
      stringField(item, "updatedAt") ?? "-",
    ].join("\t");
  });
  return ["NAME\tSTATUS\tSOURCE\tREGION\tUPDATED", ...rows].join("\n");
}

function formatServer(value: unknown): string {
  if (!isRecord(value)) return String(value);
  const repository = objectField(value, "connectedRepository");
  const source =
    booleanField(repository, "isManaged") === true
      ? "managed"
      : repository !== undefined
        ? "github"
        : stringField(value, "externalUrl") !== undefined
          ? "external"
          : "-";
  const watchPaths = stringArrayField(repository, "watchPaths");
  const deployBranches = stringArrayField(repository, "deployBranchPatterns");
  const waitForCi = booleanField(repository, "waitForCi");
  return [
    `Name: ${stringField(value, "name") ?? "-"}`,
    `ID: ${stringField(value, "id") ?? "-"}`,
    `Slug: ${stringField(value, "slug") ?? "-"}`,
    `Status: ${stringField(value, "status") ?? stringField(value, "latestDeploymentStatus") ?? "-"}`,
    `Source: ${source}`,
    `Region: ${stringField(value, "region") ?? "AUTO"}`,
    `MCP URL: ${stringField(value, "mcpUrl") ?? "-"}`,
    ...(repository !== undefined
      ? [
          `Watch paths: ${watchPaths.length > 0 ? watchPaths.join(", ") : "all changes"}`,
          `Deploy branches: ${deployBranches.length > 0 ? deployBranches.join(", ") : "all branches"}`,
          `Wait for CI: ${waitForCi === true ? "yes" : "no"}`,
        ]
      : []),
    `Updated: ${stringField(value, "updatedAt") ?? "-"}`,
  ].join("\n");
}

function arrayField(value: unknown, key: string): Record<string, unknown>[] {
  if (!isRecord(value)) return [];
  const field = value[key];
  return Array.isArray(field) ? field.filter(isRecord) : [];
}

function objectField(
  value: unknown,
  key: string
): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return isRecord(field) ? field : undefined;
}

function stringField(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === "string" && field !== "" ? field : undefined;
}

function booleanField(value: unknown, key: string): boolean | undefined {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === "boolean" ? field : undefined;
}

function stringArrayField(value: unknown, key: string): string[] {
  if (!isRecord(value)) return [];
  const field = value[key];
  return Array.isArray(field)
    ? field.filter((item): item is string => typeof item === "string")
    : [];
}

function normalizePatterns(
  values: string[],
  option: string,
  maxLength: number
): string[] {
  if (values.length === 1 && values[0] === "") return [];
  if (values.length > 32) {
    throw new UsageError(`${option} accepts at most 32 patterns.`);
  }
  if (values.some((value) => value === "")) {
    throw new UsageError(
      `${option} accepts an empty value only by itself to clear all patterns.`
    );
  }
  if (values.some((value) => value.length > maxLength)) {
    throw new UsageError(
      `${option} patterns may not exceed ${maxLength} characters.`
    );
  }
  return values;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function commonListOptions() {
  return {
    ...commonOrgJsonOptions(),
    limit: { type: "string" as const, default: "30" },
    skip: { type: "string" as const, default: "0" },
  };
}

function exactlyOne(positionals: string[], usage: string): string {
  if (positionals.length !== 1) throw new UsageError(`Usage: ${usage}`);
  return positionals[0]!;
}

function parsePagination(
  rawLimit: string | undefined,
  rawSkip: string | undefined
): { limit: number; skip: number } {
  const limit = Number(rawLimit ?? "30");
  const skip = Number(rawSkip ?? "0");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new UsageError("--limit must be an integer from 1 to 100.");
  }
  if (!Number.isInteger(skip) || skip < 0) {
    throw new UsageError("--skip must be a non-negative integer.");
  }
  return { limit, skip };
}
