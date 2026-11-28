/**
 * `mcp-use client <name> events list|poll|subscribe|unsubscribe`: raw
 * `events/*` requests against a saved server.
 */

import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";

import type { MCPConnection } from "@mcp-use/client";

import { UsageError } from "../core/errors.js";
import { printResult } from "../core/output.js";

interface EventsArgs {
  operation: "list" | "poll" | "subscribe" | "unsubscribe";
  event?: string;
  rest: string[];
  cursor?: string;
  follow: boolean;
  maxEvents?: number | undefined;
  url?: string;
  secret?: string;
  ttl?: number | undefined;
}

const OPERATIONS = ["list", "poll", "subscribe", "unsubscribe"] as const;

/** Parse `events` arguments; throws a UsageError before any connection. */
export function parseEventsArgs(
  server: string,
  operation: string | undefined,
  argv: readonly string[]
): EventsArgs {
  const usage = `Usage: mcp-use client ${server} events <${OPERATIONS.join("|")}> ...`;
  if (!OPERATIONS.includes(operation as EventsArgs["operation"]))
    throw new UsageError(usage);
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      cursor: { type: "string" },
      follow: { type: "boolean" },
      "max-events": { type: "string" },
      url: { type: "string" },
      secret: { type: "string" },
      ttl: { type: "string" },
    },
  });
  const op = operation as EventsArgs["operation"];
  const positive = (v: string | undefined, flag: string) => {
    if (v === undefined) return undefined;
    if (!/^\d+$/.test(v) || Number(v) < 1 || !Number.isSafeInteger(Number(v)))
      throw new UsageError(`${flag} must be a positive integer.`);
    return Number(v);
  };
  const allowed: Record<EventsArgs["operation"], readonly string[]> = {
    list: [],
    poll: ["cursor", "follow", "max-events"],
    subscribe: ["url", "secret", "ttl"],
    unsubscribe: ["url"],
  };
  for (const flag of Object.keys(values))
    if (!allowed[op].includes(flag))
      throw new UsageError(`--${flag} does not apply to events ${op}.`);
  if (op === "list") {
    if (positionals.length > 0) throw new UsageError(usage);
    return { operation: op, rest: [], follow: false };
  }
  const [event, ...rest] = positionals;
  if (event === undefined)
    throw new UsageError(
      `Usage: mcp-use client ${server} events ${op} <event> [args...]`
    );
  if ((op === "subscribe" || op === "unsubscribe") && !values.url)
    throw new UsageError(`events ${op} requires --url <url>.`);
  return {
    operation: op,
    event,
    rest,
    follow: values.follow === true,
    ...(values.cursor !== undefined && { cursor: values.cursor }),
    ...(values["max-events"] !== undefined && {
      maxEvents: positive(values["max-events"], "--max-events"),
    }),
    ...(values.url !== undefined && { url: values.url }),
    ...(values.secret !== undefined && { secret: values.secret }),
    ...(values.ttl !== undefined && { ttl: positive(values.ttl, "--ttl") }),
  };
}

interface Occurrence {
  eventId: string;
  timestamp: string;
  data: unknown;
}

/**
 * Send an `events/*` request that declares the official events extension in
 * the per-request `_meta`, so the server answers in the official dialect even
 * when the loaded `@mcp-use/client` predates declaring it itself.
 */
async function request(
  connection: MCPConnection,
  method: string,
  params: Record<string, unknown>
): Promise<unknown> {
  try {
    return await connection.request(method, {
      ...params,
      _meta: {
        "io.modelcontextprotocol/clientCapabilities": {
          extensions: { "io.modelcontextprotocol/events": {} },
        },
      },
    });
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === -32601) {
      const webhook =
        method === "events/subscribe" || method === "events/unsubscribe";
      throw new UsageError(
        webhook
          ? `The server does not support webhook delivery (${method} is not implemented). Use \`events poll\` instead.`
          : `The server does not implement ${method}.`,
        webhook ? { code: "webhook_unsupported" } : {}
      );
    }
    throw error;
  }
}

/**
 * Refuse a webhook subscribe/unsubscribe for an event whose `events/list`
 * entry does not offer webhook delivery.
 */
async function assertWebhookOffered(
  connection: MCPConnection,
  name: string
): Promise<void> {
  const { events = [] } = (await request(connection, "events/list", {})) as {
    events?: { name: string; delivery?: string[] }[];
  };
  const delivery = events.find((e) => e.name === name)?.delivery;
  if (!Array.isArray(delivery) || delivery.includes("webhook")) return;
  throw new UsageError(
    `Event "${name}" supports only ${delivery.join(", ") || "no"} delivery, not webhook. Use \`events poll ${name}\` instead.`,
    { code: "webhook_unsupported" }
  );
}

/** Run a parsed `events` command over an open connection. */
export async function runEventsCommand(
  connection: MCPConnection,
  args: EventsArgs,
  parsedArguments: Record<string, unknown>,
  json: boolean
): Promise<number> {
  const name = args.event!;
  if (args.operation === "list") {
    const { events = [] } = (await request(connection, "events/list", {})) as {
      events?: { name: string; description?: string; delivery?: string[] }[];
    };
    printResult(
      events,
      json,
      events
        .map(
          (e) =>
            `${e.name} [${(e.delivery ?? []).join(", ")}]${e.description ? ` - ${e.description}` : ""}`
        )
        .join("\n") || "No events."
    );
    return 0;
  }
  if (args.operation === "subscribe") {
    await assertWebhookOffered(connection, name);
    const secret = args.secret ?? `whsec_${randomBytes(32).toString("base64")}`;
    const result = await request(connection, "events/subscribe", {
      name,
      arguments: parsedArguments,
      delivery: { mode: "webhook", url: args.url, secret },
      cursor: null,
      ...(args.ttl !== undefined && { ttlMs: args.ttl }),
    });
    // Print the secret only when it was generated here.
    const generated = args.secret === undefined;
    const { _meta: _ignored, ...out } = result as Record<string, unknown>;
    printResult(
      generated ? { ...out, secret } : out,
      json,
      `Subscribed ${String(out.id)} (refresh before ${String(out.refreshBefore)})` +
        (generated ? `\nSecret: ${secret}` : "")
    );
    return 0;
  }
  if (args.operation === "unsubscribe") {
    await request(connection, "events/unsubscribe", {
      name,
      arguments: parsedArguments,
      delivery: { mode: "webhook", url: args.url },
    });
    printResult({ unsubscribed: true }, json, "Unsubscribed.");
    return 0;
  }
  let cursor: string | null = args.cursor ?? null;
  const controller = new AbortController();
  const stop = () => controller.abort();
  if (args.follow) process.once("SIGINT", stop);
  try {
    for (;;) {
      const page = (await request(connection, "events/poll", {
        name,
        arguments: parsedArguments,
        cursor,
        ...(args.maxEvents !== undefined && { maxEvents: args.maxEvents }),
      })) as {
        events: Occurrence[];
        cursor: string | null;
        truncated: boolean;
        hasMore: boolean;
        nextPollMs: number;
      };
      cursor = page.cursor;
      if (!args.follow) {
        const { events, truncated, hasMore, nextPollMs } = page;
        printResult(
          { events, cursor, truncated, hasMore, nextPollMs },
          json,
          [
            ...page.events.map(
              (e) => `${e.timestamp}\t${e.eventId}\t${JSON.stringify(e.data)}`
            ),
            `cursor: ${page.cursor}${page.truncated ? " (truncated)" : ""}${page.hasMore ? " (more available)" : ""}`,
          ].join("\n")
        );
        return 0;
      }
      for (const e of page.events)
        printResult(
          e,
          json,
          `${e.timestamp}\t${e.eventId}\t${JSON.stringify(e.data)}`
        );
      if (page.truncated)
        process.stderr.write("Events may have been missed (truncated).\n");
      try {
        await delay(
          page.hasMore ? 0 : Math.max(page.nextPollMs, 1000),
          undefined,
          {
            signal: controller.signal,
          }
        );
      } catch {
        return 0;
      }
    }
  } finally {
    process.removeListener("SIGINT", stop);
  }
}
