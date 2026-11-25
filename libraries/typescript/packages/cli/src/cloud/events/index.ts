/**
 * `mcp-use events …` (PLAN.md §11.4) in Cloud mode (`--server`, link file or
 * `MANUFACT_SERVER`; `--branch` or `--production`) and local mode
 * (`--env-file`, or `--storage-url`/`--namespace`/`--secret`; plus `--url`
 * and `--admin-secret` for commands that need the running app).
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parseCommandArgs, runCommand } from "../../core/command.js";
import { CommandError, UsageError } from "../../core/errors.js";
import { fields } from "../../core/format.js";
import { confirm } from "../../core/prompt.js";
import { cloudHelp } from "../help.js";
import { connectProject, PROJECT_OPTIONS } from "../project/resolve.js";
import { projectRoot } from "../project/link-file.js";
import { cloudEventsApi, type CloudTarget } from "./api.js";
import {
  CLOUD_EVENTS_PAGE_LIMIT,
  type CloudAttemptRecord,
  type CloudSubscriptionView,
} from "./contract.js";
import {
  callAppRoute,
  isLocal,
  LOCAL_OPTIONS,
  localEnv,
  openLocalAdmin,
  toSdkRecord,
  type SdkProjectable,
} from "./local.js";
import {
  formatCatalog,
  formatDeadLetters,
  formatDeliveries,
  formatStatus,
  formatSubscription,
  formatSubscriptions,
} from "./output.js";

const COMMANDS = [
  "status",
  "catalog",
  "subscriptions",
  "subscription",
  "deliveries",
  "redeliver",
  "revoke",
  "emit",
  "purge",
  "export",
] as const;
type Command = (typeof COMMANDS)[number];

const USAGE = `mcp-use events <${COMMANDS.join("|")}> [options]`;
const POSITIONALS: Partial<Record<Command, number>> = {
  subscription: 1,
  redeliver: 1,
  emit: 1,
};

/** Options per command, on top of project, local and target options. */
function optionsFor(command: Command) {
  const common = {
    ...PROJECT_OPTIONS,
    ...LOCAL_OPTIONS,
    json: { type: "boolean" },
    branch: { type: "string" },
    production: { type: "boolean" },
  } as const;
  const page = {
    after: { type: "string" },
    limit: { type: "string" },
  } as const;
  const app = {
    url: { type: "string" },
    "admin-secret": { type: "string" },
    yes: { type: "boolean" },
  } as const;
  switch (command) {
    case "subscriptions":
      return {
        ...common,
        ...page,
        event: { type: "string" },
        principal: { type: "string" },
        status: { type: "string" },
        mode: { type: "string" },
      } as const;
    case "deliveries":
      return {
        ...common,
        ...page,
        failed: { type: "boolean" },
        "dead-letters": { type: "boolean" },
        subscription: { type: "string" },
        follow: { type: "boolean" },
      } as const;
    case "revoke":
      return {
        ...common,
        principal: { type: "string" },
        event: { type: "string" },
        subscription: { type: "string" },
        reason: { type: "string" },
      } as const;
    case "emit":
      return {
        ...common,
        ...app,
        data: { type: "string" },
        "event-id": { type: "string" },
        principal: { type: "string" },
        subscription: { type: "string" },
      } as const;
    case "purge":
      return { ...common, ...app } as const;
    case "export":
      return { ...common, format: { type: "string" } } as const;
    default:
      return common;
  }
}

type Values = Record<string, string | boolean | undefined>;

function str(values: Values, key: string): string | undefined {
  const value = values[key];
  return typeof value === "string" ? value : undefined;
}

function limitOf(values: Values): string | undefined {
  const raw = str(values, "limit");
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1 || n > CLOUD_EVENTS_PAGE_LIMIT.max)
    throw new UsageError(
      `Pass --limit between 1 and ${CLOUD_EVENTS_PAGE_LIMIT.max}.`
    );
  return raw;
}

function enumOf(
  values: Values,
  key: string,
  allowed: readonly string[]
): string | undefined {
  const value = str(values, key);
  if (value !== undefined && !allowed.includes(value))
    throw new UsageError(`Pass --${key} as one of: ${allowed.join(", ")}.`);
  return value;
}

async function readData(spec: string | undefined): Promise<unknown> {
  if (spec === undefined)
    throw new UsageError("Pass --data <json|@file.json>.");
  const text = spec.startsWith("@")
    ? await readFile(resolve(spec.slice(1)), "utf8").catch(() => {
        throw new UsageError(`Cannot read ${spec.slice(1)}.`);
      })
    : spec;
  try {
    return JSON.parse(text);
  } catch {
    throw new UsageError("--data is not valid JSON.");
  }
}

/** Short namespace hash shown before production-affecting local writes. */
function namespaceHash(namespace: string): string {
  return createHash("sha256")
    .update(namespace)
    .digest("base64url")
    .slice(0, 16);
}

/** Run `mcp-use events …`. */
export async function runEvents(argv: readonly string[]): Promise<number> {
  const help = cloudHelp("events", argv);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(help);
    return 0;
  }
  return runCommand(argv, help, async (output) => {
    const command = argv[0] as Command;
    if (!COMMANDS.includes(command)) throw new UsageError(`Usage: ${USAGE}`);
    const { values: parsed, positionals } = parseCommandArgs(argv.slice(1), {
      options: optionsFor(command),
      positionals: POSITIONALS[command] ?? 0,
      usage: USAGE,
    });
    const values = parsed as Values;
    if (values.branch !== undefined && values.production === true)
      throw new UsageError("Pass either --branch or --production, not both.");
    const local = isLocal(values);
    if (command === "export") {
      if (str(values, "format") !== "sdk")
        throw new UsageError("Pass --format sdk.");
      if (!local)
        throw new UsageError(
          "events export reads secrets and runs in local mode only. Pass --env-file <path>.",
          { code: "local_only" }
        );
    }
    if (local) {
      await runLocal(command, values, positionals, output);
      return;
    }
    await runCloud(command, values, positionals, output);
  });
}

type Output = Parameters<Parameters<typeof runCommand>[2]>[0];

async function runCloud(
  command: Command,
  values: Values,
  positionals: string[],
  output: Output
): Promise<void> {
  const branch = str(values, "branch");
  const target: CloudTarget =
    branch !== undefined
      ? { branch }
      : values.production === true
        ? { production: true }
        : null;
  const writes = ["redeliver", "revoke", "emit", "purge"].includes(command);
  if (writes && target === null)
    throw new UsageError(
      `events ${command} changes state. Pass --branch <name>, or --production for production.`,
      { code: "target_required" }
    );
  if (command === "purge" && target !== null && "production" in target)
    throw new UsageError(
      "events purge only runs on a branch. Pass --branch <name>."
    );
  if (command === "deliveries" && values.follow === true)
    // TODO(events): --follow polls /deliveries with `after` until interrupted.
    throw new UsageError("--follow is not supported yet.", {
      code: "not_supported",
    });
  if (command === "purge" || command === "emit") {
    const ok = await confirm(
      command === "purge"
        ? `Purge all Events state of branch ${branch}?`
        : `Emit ${positionals[0]} on ${branch ?? "production"}?`,
      { yes: values.yes === true, json: output.json }
    );
    if (!ok) throw new CommandError("cancelled", "Cancelled.");
  }
  const { cloud, server } = await connectProject(values);
  const found = await cloud.call(
    cloud.client.GET("/api/v1/servers/{id}", {
      params: { path: { id: server } },
    })
  );
  const api = cloudEventsApi(cloud, found.id, target);
  switch (command) {
    case "status": {
      const r = await api.get("status", "/status");
      return output.result(r, formatStatus(r));
    }
    case "catalog": {
      const r = await api.get("catalog", "/catalog");
      return output.result(r, formatCatalog(r));
    }
    case "subscriptions": {
      const r = await api.get("subscriptions", "/subscriptions", {
        event: str(values, "event"),
        principal: str(values, "principal"),
        status: enumOf(values, "status", ["active", "suspended"]),
        mode: enumOf(values, "mode", ["webhook", "push", "poll"]),
        after: str(values, "after"),
        limit: limitOf(values),
      });
      return output.result(r, formatSubscriptions(r));
    }
    case "subscription": {
      const r = await api.get(
        "subscription",
        `/subscriptions/${encodeURIComponent(positionals[0]!)}`
      );
      return output.result(r, formatSubscription(r));
    }
    case "deliveries": {
      if (values["dead-letters"] === true) {
        const r = await api.get("deadLetters", "/dead-letters", {
          subscription: str(values, "subscription"),
          after: str(values, "after"),
          limit: limitOf(values),
        });
        return output.result(r, formatDeadLetters(r));
      }
      const r = await api.get("deliveries", "/deliveries", {
        status: values.failed === true ? "failed" : undefined,
        subscription: str(values, "subscription"),
        after: str(values, "after"),
        limit: limitOf(values),
      });
      return output.result(r, formatDeliveries(r));
    }
    case "redeliver": {
      const r = await api.post(
        "redeliver",
        `/dead-letters/${encodeURIComponent(positionals[0]!)}:redeliver`
      );
      return output.result(r, `Redelivery queued as ${r.jobId}`);
    }
    case "revoke": {
      const body = revokeFilter(values);
      const r = await api.post("revoke", "/revoke", body);
      return output.result(r, `Revoked ${r.removed} subscription(s)`);
    }
    case "emit": {
      const r = await api.post("emit", "/emit", {
        name: positionals[0],
        data: await readData(str(values, "data")),
        ...optional("eventId", str(values, "event-id")),
        ...optional("principal", str(values, "principal")),
        ...optional("subscriptionId", str(values, "subscription")),
      });
      return output.result(
        r,
        fields([
          ["Event ID", r.eventId],
          ["Accepted", r.accepted ? "yes" : "no"],
          ["Duplicate", r.duplicate ? "yes" : "no"],
        ])
      );
    }
    case "purge": {
      const r = await api.post("purge", "/purge");
      return output.result(
        r,
        `Purged branch ${branch}: ${r.deletedKeys} keys deleted, ${r.terminated} subscriptions terminated`
      );
    }
    default:
      throw new UsageError(`Usage: ${USAGE}`);
  }
}

function optional(key: string, value: unknown): Record<string, unknown> {
  return value === undefined ? {} : { [key]: value };
}

function revokeFilter(values: Values): Record<string, unknown> {
  const principal = str(values, "principal");
  const subscriptionId = str(values, "subscription");
  if (principal === undefined && subscriptionId === undefined)
    throw new UsageError("Pass --principal <p> or --subscription <id>.");
  return {
    ...optional("principal", principal),
    ...optional("name", str(values, "event")),
    ...optional("subscriptionId", subscriptionId),
    ...optional("reason", str(values, "reason")),
  };
}

function requireApp(values: Values): { url: string; adminSecret: string } {
  const url = str(values, "url");
  const adminSecret =
    str(values, "admin-secret") ?? process.env["MCP_USE_EVENTS_ADMIN_SECRET"];
  if (url === undefined || adminSecret === undefined)
    throw new UsageError(
      "This command needs the running app. Pass --url <app-url> and --admin-secret <secret>."
    );
  return { url, adminSecret };
}

async function runLocal(
  command: Command,
  values: Values,
  positionals: string[],
  output: Output
): Promise<void> {
  if (command === "deliveries" && values.follow === true)
    throw new UsageError("--follow is Cloud-only.", { code: "cloud_only" });
  const root = projectRoot(str(values, "path"));
  const env = await localEnv(values);
  const admin = await openLocalAdmin(root, env);
  switch (command) {
    case "status": {
      const r = await admin.status();
      return output.result(
        r,
        formatStatus(r as unknown as Parameters<typeof formatStatus>[0])
      );
    }
    case "catalog": {
      const r = await admin.catalog();
      return output.result(
        r,
        formatCatalog({
          active: (r ?? null) as Parameters<typeof formatCatalog>[0]["active"],
        })
      );
    }
    case "subscriptions": {
      const mode = enumOf(values, "mode", ["webhook", "push", "poll"]);
      const q = {
        ...optional("name", str(values, "event")),
        ...optional("principal", str(values, "principal")),
        ...optional("after", str(values, "after")),
        ...optional("limit", limitOf(values) && Number(limitOf(values))),
      };
      const r =
        mode === "push" || mode === "poll"
          ? await admin.leases(q)
          : await admin.subscriptions({
              ...q,
              ...optional(
                "status",
                enumOf(values, "status", ["active", "suspended"])
              ),
            });
      return output.result(
        r,
        formatSubscriptions(r as { items: CloudSubscriptionView[] })
      );
    }
    case "subscription": {
      const r = await admin.subscription(positionals[0]!);
      if (r === null)
        throw new CommandError(
          "not_found",
          `No subscription ${positionals[0]}.`
        );
      return output.result(
        r,
        formatSubscription(
          r as CloudSubscriptionView & { attempts: CloudAttemptRecord[] }
        )
      );
    }
    case "deliveries": {
      if (values["dead-letters"] === true) {
        const r = await admin.deadLetters({
          ...optional("subscriptionId", str(values, "subscription")),
          ...optional("after", str(values, "after")),
        });
        return output.result(
          r,
          formatDeadLetters(
            r as unknown as Parameters<typeof formatDeadLetters>[0]
          )
        );
      }
      const sub = str(values, "subscription");
      if (sub === undefined)
        throw new UsageError(
          "Locally, deliveries reads one subscription's attempts. Pass --subscription <id> or --dead-letters."
        );
      const r = (await admin.subscription(sub)) as {
        attempts: CloudAttemptRecord[];
      } | null;
      if (r === null)
        throw new CommandError("not_found", `No subscription ${sub}.`);
      const attempts = r.attempts.filter(
        (a) => values.failed !== true || a.outcome !== "ok"
      );
      return output.result(
        { items: attempts },
        formatSubscription({
          ...(r as unknown as CloudSubscriptionView),
          attempts,
        })
      );
    }
    case "redeliver": {
      const r = await admin.redeliver(positionals[0]!);
      return output.result(r, `Redelivery queued as ${r.jobId}`);
    }
    case "revoke": {
      const r = await admin.revoke(revokeFilter(values));
      return output.result(r, `Revoked ${r.removed} subscription(s)`);
    }
    case "emit": {
      const { url, adminSecret } = requireApp(values);
      const hash = namespaceHash(admin.namespace);
      const ok = await confirm(
        `Emit ${positionals[0]} into namespace ${admin.namespace} (${hash})?`,
        { yes: values.yes === true, json: output.json }
      );
      if (!ok) throw new CommandError("cancelled", "Cancelled.");
      // TODO(events): confirm the nsHash formula against WP-26's emit route.
      const r = await callAppRoute(
        url,
        "emit",
        adminSecret,
        {
          name: positionals[0],
          data: await readData(str(values, "data")),
          ...optional("eventId", str(values, "event-id")),
          ...optional("principal", str(values, "principal")),
          ...optional("subscriptionId", str(values, "subscription")),
        },
        { "x-mcp-use-confirm": hash }
      );
      return output.result(r, JSON.stringify(r));
    }
    case "purge": {
      const { url, adminSecret } = requireApp(values);
      const ok = await confirm(
        `Decommission and purge namespace ${admin.namespace}?`,
        { yes: values.yes === true, json: output.json }
      );
      if (!ok) throw new CommandError("cancelled", "Cancelled.");
      const decommission = await callAppRoute(
        url,
        "admin/decommission",
        adminSecret,
        {}
      );
      const r = await admin.purge();
      const result = { ...(decommission as object), ...r };
      return output.result(result, `Purged ${r.deletedKeys} keys`);
    }
    case "export": {
      if (typeof admin.webhookRecords !== "function")
        throw new CommandError(
          "MCP_USE_EVENTS_EXPORT_UNSUPPORTED",
          "The installed mcp-use admin library cannot export webhook records. Upgrade mcp-use."
        );
      const records: Record<string, unknown>[] = [];
      const source = await admin.webhookRecords();
      for await (const record of source as AsyncIterable<SdkProjectable>)
        records.push(toSdkRecord(record));
      return output.result(
        records,
        records.map((r) => JSON.stringify(r)).join("\n")
      );
    }
    default:
      throw new UsageError(`Usage: ${USAGE}`);
  }
}
