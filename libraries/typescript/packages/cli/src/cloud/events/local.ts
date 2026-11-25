/**
 * Local mode of `mcp-use events …` (PLAN.md §11.4): the admin library over a
 * store binding the user names, with no Cloud involved.
 *
 * The CLI does not depend on `mcp-use` (CODE-B1): `mcp-use/events/admin` is
 * imported from the project's own `node_modules`, so the admin library always
 * matches the server's layout. A project without `mcp-use` gets
 * `MCP_USE_NOT_INSTALLED` with an install hint.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

import { CommandError, UsageError } from "../../core/errors.js";

/** The admin surface local mode uses (structural copy of mcp-use's `EventsAdmin`). */
export interface LocalEventsAdmin {
  readonly namespace: string;
  status(): Promise<Record<string, unknown>>;
  catalog(): Promise<unknown>;
  subscriptions(
    q?: Record<string, unknown>
  ): Promise<{ items: unknown[]; next?: string }>;
  subscription(id: string): Promise<unknown>;
  leases(
    q?: Record<string, unknown>
  ): Promise<{ items: unknown[]; next?: string }>;
  deadLetters(
    q?: Record<string, unknown>
  ): Promise<{ items: unknown[]; next?: string }>;
  redeliver(id: string): Promise<{ jobId: string }>;
  revoke(filter: Record<string, unknown>): Promise<{ removed: number }>;
  purge(): Promise<{ deletedKeys: number }>;
  /**
   * Stored webhook records, unsealed with the keyring (§12.3.3 shared record
   * codec). Optional: older admin libraries do not have it.
   */
  webhookRecords?(): AsyncIterable<SdkProjectable> | Promise<SdkProjectable[]>;
}

/** The fields of a stored webhook record that the SDK projection reads. */
export interface SdkProjectable {
  id: string;
  principal: string;
  name: string;
  args: Record<string, unknown>;
  url: string;
  secret: string;
  previousSecret?: { secret: string; expiresAt: number };
  expiresAt: number | null;
  createdAt: number;
}

/** Local binding flags. */
export interface LocalFlags {
  "env-file"?: string | undefined;
  "storage-url"?: string | undefined;
  "storage-token"?: string | undefined;
  "storage-prefix"?: string | undefined;
  namespace?: string | undefined;
  secret?: string | undefined;
  path?: string | undefined;
}

/** `parseCommandArgs` options for {@link LocalFlags}. */
export const LOCAL_OPTIONS = {
  "env-file": { type: "string" },
  "storage-url": { type: "string" },
  "storage-token": { type: "string" },
  "storage-prefix": { type: "string" },
  namespace: { type: "string" },
  secret: { type: "string" },
} as const;

/** Whether any local-binding flag was passed. */
export function isLocal(flags: LocalFlags): boolean {
  return (
    flags["env-file"] !== undefined ||
    flags["storage-url"] !== undefined ||
    flags.namespace !== undefined
  );
}

/**
 * The environment the admin library resolves its binding from: the process
 * environment, then `--env-file`, then explicit flags.
 */
export async function localEnv(
  flags: LocalFlags
): Promise<Record<string, string | undefined>> {
  const env: Record<string, string | undefined> = { ...process.env };
  if (flags["env-file"] !== undefined) {
    let text: string;
    try {
      text = await readFile(resolve(flags["env-file"]), "utf8");
    } catch {
      throw new UsageError(`Cannot read --env-file ${flags["env-file"]}.`);
    }
    Object.assign(env, parseEnv(text));
  }
  const map: Array<[keyof LocalFlags, string]> = [
    ["storage-url", "MCP_USE_STORAGE_URL"],
    ["storage-token", "MCP_USE_STORAGE_TOKEN"],
    ["storage-prefix", "MCP_USE_STORAGE_PREFIX"],
    ["namespace", "MCP_USE_EVENTS_NAMESPACE"],
    ["secret", "MCP_USE_EVENTS_SECRET"],
  ];
  for (const [flag, name] of map)
    if (flags[flag] !== undefined) env[name] = flags[flag];
  return env;
}

/** Find `node_modules/mcp-use` from `root` upwards. */
function findMcpUse(root: string): string | undefined {
  let dir = resolve(root);
  for (;;) {
    const candidate = join(dir, "node_modules", "mcp-use", "package.json");
    if (existsSync(candidate)) return dirname(candidate);
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Import `mcp-use/events/admin` from the project and open the admin library
 * from the resolved environment.
 *
 * @param root - Project root.
 * @param env - Environment from {@link localEnv}.
 */
export async function openLocalAdmin(
  root: string,
  env: Record<string, string | undefined>
): Promise<LocalEventsAdmin> {
  const dir = findMcpUse(root);
  const notInstalled = new CommandError(
    "MCP_USE_NOT_INSTALLED",
    `mcp-use is not installed in ${root}, or it has no Events admin library.`,
    undefined,
    [
      {
        description: "Install mcp-use in the project",
        command: "npm install mcp-use@latest",
      },
    ]
  );
  if (dir === undefined) throw notInstalled;
  const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as {
    exports?: Record<string, { import?: string } | string>;
  };
  const entry = pkg.exports?.["./events/admin"];
  const target = typeof entry === "string" ? entry : entry?.import;
  if (target === undefined) throw notInstalled;
  const mod = (await import(pathToFileURL(join(dir, target)).href)) as {
    openEventsAdminFromEnv?: (
      env: Record<string, string | undefined>
    ) => Promise<LocalEventsAdmin>;
  };
  if (typeof mod.openEventsAdminFromEnv !== "function") throw notInstalled;
  return mod.openEventsAdminFromEnv(env);
}

/**
 * The SDK `WebhookSubscriptionRecord` projection (D85). Same nine fields and
 * semantics as `toSdkWebhookRecord` in `@mcp-use/events-core`; restated
 * because the CLI does not depend on mcp-use packages at run time.
 */
export function toSdkRecord(record: SdkProjectable): Record<string, unknown> {
  return {
    id: record.id,
    principal: record.principal,
    name: record.name,
    arguments: { ...record.args },
    url: record.url,
    secret: record.secret,
    ...(record.previousSecret !== undefined
      ? { previousSecret: { ...record.previousSecret } }
      : {}),
    expiresAt: record.expiresAt ?? Number.MAX_SAFE_INTEGER,
    createdAt: record.createdAt,
  };
}

/**
 * Call a running app's Events route (`emit`, `admin/decommission`) with the
 * admin bearer.
 */
export async function callAppRoute(
  url: string,
  path: string,
  adminSecret: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<unknown> {
  const base = url.replace(/\/+$/, "");
  let response: Response;
  try {
    response = await fetch(`${base}/_mcp-use/events/${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${adminSecret}`,
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body ?? {}),
    });
  } catch (error) {
    throw new CommandError(
      "app_unreachable",
      `Could not reach ${base}: ${error instanceof Error ? error.message : String(error)}.`
    );
  }
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = text === "" ? {} : JSON.parse(text);
  } catch {
    /* keep text */
  }
  if (!response.ok) {
    const code =
      typeof parsed === "object" && parsed !== null && "code" in parsed
        ? String((parsed as { code: unknown }).code)
        : `http_${response.status}`;
    throw new CommandError(
      code,
      `${path} failed with HTTP ${response.status}.`,
      parsed
    );
  }
  return parsed;
}
