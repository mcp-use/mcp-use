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

/** Run the `mcp-use servers` command family. */
export async function runServers(argv: readonly string[]): Promise<number> {
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
  printResult(result, json);
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
  printResult(result, json);
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
  const body = {
    ...(values.name !== undefined ? { name: values.name } : {}),
    ...(values.description !== undefined
      ? { description: values.description }
      : {}),
    ...(values.branch !== undefined ? { productionBranch: values.branch } : {}),
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
  const result =
    existing === undefined
      ? await api.request<unknown>(
          `/servers/${encodeURIComponent(server)}/env-variables`,
          { method: "POST", body: JSON.stringify(body) }
        )
      : await api.request<unknown>(
          `/servers/${encodeURIComponent(server)}/env-variables/${encodeURIComponent(existing.id)}`,
          { method: "PATCH", body: JSON.stringify(body) }
        );
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
