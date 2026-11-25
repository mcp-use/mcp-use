/**
 * `mcp-use client <server> events <command>`, where the command is one of
 * `list`, `subscribe`, `unsubscribe`, `listen`, `poll`, `stream` and `check`
 * (PLAN.md §11.3).
 *
 * Every command except `check` runs on the `@mcp-use/client` events lane and
 * its fetch wrapper (§9.2), installed on the saved server's connection, so
 * `Mcp-Name` and `Mcp-Param-*` are set on SEP-profile requests and the legacy
 * era works. `listen` runs the client manager's runners (§9.5); `check` runs
 * the events-core conformance catalog (§9.1) over raw HTTP.
 *
 * Exit codes: 0 success, 1 operational failure (including a failed MUST
 * conformance row and a dead stream), 2 usage, 3 a stream or subscription the
 * server terminated.
 *
 * @internal
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";

import { CommandError } from "../../core/errors.js";
import { printResult } from "../../core/output.js";
import {
  parseEventsCommand,
  type EventsCommand,
  type LaneDialectFlag,
} from "./args.js";
import { clientEvents, loadClientWebhooks, loadConformance } from "./load.js";
import {
  formatConformanceText,
  formatEventLine,
  formatEventList,
  line,
  record,
} from "./output.js";
import type {
  ClientEventsModule,
  EventEnvelope,
  EventsConnectionLike,
  EventsLaneLike,
  ReceiverHandle,
} from "./types.js";

export { parseEventsCommand } from "./args.js";

/** Exit code of a stream or subscription the server terminated. */
export const EXIT_TERMINATED = 3;

/** What `client.ts` provides to the events commands. */
export interface ClientEventsContext {
  /** Saved server name. */
  server: string;
  /** Saved server URL (used by `check`). */
  url: string;
  /** Saved request headers (used by `check`). */
  headers: Record<string, string>;
  /** Tokens after `events`, with `--json` removed. */
  argv: readonly string[];
  /** `--json` was given. */
  json: boolean;
  /** Load the `@mcp-use/client` module the CLI uses. */
  loadClient(): Promise<unknown>;
  /**
   * Open the saved server with the events lane installed on its transport
   * (`wrapTransport`) and fetch (`wrapFetch`).
   */
  connect(lane: EventsLaneLike): Promise<{ disconnect(): Promise<void> }>;
}

/**
 * Run one `events` command.
 *
 * @param ctx - Server, argv and connection hooks.
 * @returns The process exit code.
 * @throws {@link UsageError} On grammar mistakes, before any connection.
 * @throws {@link CommandError} On operational failures.
 */
export async function runClientEvents(
  ctx: ClientEventsContext
): Promise<number> {
  const command = parseEventsCommand(ctx.server, ctx.argv);
  if (command.op === "check") return await check(ctx, command);

  const mod = clientEvents(await ctx.loadClient());
  const lane = mod.createSdkClientEventsAdapter({
    dialect: laneDialect(command.dialect),
    headers: ctx.headers,
  });
  const connection = await ctx.connect(lane);
  try {
    const events = mod.createEventsConnection(lane);
    await requireEvents(events, ctx.server);
    return await withDecodedErrors(mod, () => run(ctx, command, mod, events));
  } finally {
    await connection.disconnect();
  }
}

async function run(
  ctx: ClientEventsContext,
  command: Exclude<EventsCommand, { op: "check" }>,
  mod: ClientEventsModule,
  events: EventsConnectionLike
): Promise<number> {
  switch (command.op) {
    case "list": {
      const { events: list } = await events.listAllEvents();
      printResult(list, ctx.json, formatEventList(list));
      return 0;
    }
    case "subscribe": {
      const secret = command.secret ?? generateSecret();
      const result = await events.subscribeEvent({
        name: command.name,
        arguments: command.args,
        delivery: { mode: "webhook", url: command.url, secret },
        ...(command.cursor !== undefined ? { cursor: command.cursor } : {}),
        ...(command.maxAgeMs !== undefined
          ? { maxAgeMs: command.maxAgeMs }
          : {}),
        ...(command.ttlMs !== undefined ? { ttlMs: command.ttlMs } : {}),
      });
      printResult(
        { ...result, secret },
        ctx.json,
        [
          `Subscribed ${command.name}: ${result.id}`,
          `secret: ${secret}`,
          `cursor: ${result.cursor ?? "-"}`,
          `refreshBefore: ${result.refreshBefore ?? "-"}`,
          ...(result.truncated ? ["truncated: true"] : []),
        ].join("\n")
      );
      return 0;
    }
    case "unsubscribe": {
      await events.unsubscribeEvent({
        name: command.name,
        arguments: command.args,
        delivery: { mode: "webhook", url: command.url },
      });
      printResult(
        { unsubscribed: command.name },
        ctx.json,
        `Unsubscribed ${command.name}.`
      );
      return 0;
    }
    case "poll":
      return await poll(ctx, command, events);
    case "stream":
      return await stream(ctx, command, events);
    case "listen":
      return await listen(ctx, command, mod, events);
    default: {
      const unknownOp: never = command;
      throw new Error(`Unknown events command ${JSON.stringify(unknownOp)}`);
    }
  }
}

function laneDialect(dialect: LaneDialectFlag): {
  declareExtension?: boolean;
  sendMcpName?: boolean;
} {
  // ChatGPT (`KNOWN_CLIENTS` row `chatgpt`): no extension declaration and no
  // `Mcp-Name`; the server answers in the OpenAI profile.
  if (dialect === "chatgpt")
    return { declareExtension: false, sendMcpName: false };
  if (dialect === "sep-3415")
    return { declareExtension: true, sendMcpName: true };
  return {};
}

async function requireEvents(
  events: EventsConnectionLike,
  server: string
): Promise<void> {
  if (events.supportsEvents() === true) return;
  // Servers that serve Events without advertising them answer the opt-in probe.
  if (await events.probe().catch(() => false)) return;
  throw new CommandError(
    "events_not_supported",
    `Server ${server} does not support MCP Events.`,
    { server }
  );
}

/** Decode JSON-RPC errors into `events_<kind>` codes that keep the raw code. */
async function withDecodedErrors<T>(
  mod: ClientEventsModule,
  body: () => Promise<T>
): Promise<T> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof mod.EventsLaneError) {
      const kind = error.kind ?? "error";
      throw new CommandError(
        `events_${kind.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`,
        `${error.message} (${kind}, JSON-RPC ${error.code})`,
        {
          kind,
          rpcCode: error.code,
          ...(error.data !== undefined ? { data: error.data } : {}),
        }
      );
    }
    throw error;
  }
}

function generateSecret(): string {
  return `whsec_${randomBytes(32).toString("base64")}`;
}

/** Resolves on SIGINT or SIGTERM, or when `signal` aborts. */
function untilStopped(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      process.off("SIGINT", done);
      process.off("SIGTERM", done);
      signal.removeEventListener("abort", done);
      resolve();
    };
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
    if (signal.aborted) done();
    else signal.addEventListener("abort", done, { once: true });
  });
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true }
    );
  });
}

async function poll(
  ctx: ClientEventsContext,
  command: Extract<EventsCommand, { op: "poll" }>,
  events: EventsConnectionLike
): Promise<number> {
  const params = {
    name: command.name,
    arguments: command.args,
    ...(command.maxAgeMs !== undefined ? { maxAgeMs: command.maxAgeMs } : {}),
    ...(command.maxEvents !== undefined
      ? { maxEvents: command.maxEvents }
      : {}),
  };
  if (!command.follow) {
    const result = await events.pollEvents({
      ...params,
      ...(command.cursor !== undefined ? { cursor: command.cursor } : {}),
    });
    const now = new Date().toISOString();
    printResult(
      result,
      ctx.json,
      [
        ...result.events.map((e) => formatEventLine(now, e)),
        `cursor: ${result.cursor ?? "-"}`,
        ...(result.hasMore ? ["hasMore: true"] : []),
        ...(result.truncated ? ["truncated: true"] : []),
      ].join("\n")
    );
    return 0;
  }

  const stop = new AbortController();
  void untilStopped(stop.signal).then(() => stop.abort());
  let cursor = command.cursor;
  while (!stop.signal.aborted) {
    const result = await events.pollEvents(
      { ...params, ...(cursor !== undefined ? { cursor } : {}) },
      { signal: stop.signal }
    );
    const now = new Date().toISOString();
    if (result.truncated) {
      if (ctx.json) record({ type: "gap", cursor: result.cursor });
      else line(`${now} gap cursor=${result.cursor ?? "-"}`);
    }
    for (const event of result.events) {
      if (ctx.json) record({ type: "event", at: now, ...event });
      else line(formatEventLine(now, event));
    }
    cursor = result.cursor;
    if (ctx.json) {
      record({ type: "cursor", cursor, hasMore: result.hasMore });
    }
    if (result.hasMore) continue;
    await sleep(result.nextPollMs ?? 5_000, stop.signal);
  }
  return 0;
}

async function stream(
  ctx: ClientEventsContext,
  command: Extract<EventsCommand, { op: "stream" }>,
  events: EventsConnectionLike
): Promise<number> {
  const stop = new AbortController();
  void untilStopped(stop.signal).then(() => stop.abort());
  const frame = (
    type: string,
    fields: Record<string, unknown>,
    human: string
  ) => {
    const at = new Date().toISOString();
    if (ctx.json) record({ type, at, ...fields });
    else line(`${at} ${human}`);
  };
  const outcome = await events.streamEvents(
    {
      name: command.name,
      arguments: command.args,
      ...(command.cursor !== undefined ? { cursor: command.cursor } : {}),
      ...(command.maxAgeMs !== undefined ? { maxAgeMs: command.maxAgeMs } : {}),
      ...(command.heartbeatMs !== undefined
        ? { heartbeatMs: command.heartbeatMs }
        : {}),
    },
    {
      onActive: (p) =>
        frame(
          "active",
          {
            cursor: p.cursor,
            truncated: p.truncated,
            heartbeatMs: p.heartbeatMs,
          },
          `active cursor=${p.cursor ?? "-"} heartbeatMs=${p.heartbeatMs}${p.truncated ? " truncated" : ""}`
        ),
      onEvent: (e) =>
        frame(
          "event",
          { event: e },
          `event ${e.eventId} cursor=${e.cursor ?? "-"} ${JSON.stringify(e.data)}`
        ),
      onHeartbeat: (h) =>
        frame(
          "heartbeat",
          { cursor: h.cursor },
          `heartbeat cursor=${h.cursor ?? "-"}`
        ),
      onError: (p) =>
        frame(
          "error",
          { error: p.error },
          `error ${p.error.code} ${p.error.message}`
        ),
    },
    { signal: stop.signal }
  );
  stop.abort();
  frame(
    "end",
    {
      end: outcome.end,
      cursor: outcome.cursor,
      ...(outcome.error ? { error: outcome.error } : {}),
    },
    `end ${outcome.end} cursor=${outcome.cursor ?? "-"}${outcome.error ? ` ${outcome.error.code} ${outcome.error.message}` : ""}`
  );
  if (outcome.end === "terminated") return EXIT_TERMINATED;
  if (outcome.end === "closed" || outcome.end === "aborted") return 0;
  throw new CommandError(
    outcome.end === "no_active"
      ? "events_stream_no_active"
      : "events_stream_dead",
    outcome.end === "no_active"
      ? "The server did not confirm the stream (no notifications/events/active)."
      : "The stream ended without a graceful close.",
    { cursor: outcome.cursor }
  );
}

async function listen(
  ctx: ClientEventsContext,
  command: Extract<EventsCommand, { op: "listen" }>,
  mod: ClientEventsModule,
  events: EventsConnectionLike
): Promise<number> {
  const stop = new AbortController();
  const webhook = command.mode === "webhook" || command.tunnel;
  let exitCode = 0;
  let delivered = 0;
  let failure: Error | undefined;
  // The `webhook-id` of the request being handled, for the delivery line.
  const requestContext = new AsyncLocalStorage<{ webhookId: string }>();
  let receiverUrl: string | undefined;

  const manager = mod.createEventsManager({
    connection: async () => events,
    receiverUrl: () => receiverUrl,
    dialect: command.dialect,
    resume: "off",
    ...(command.mode !== undefined ? { prefer: [command.mode] } : {}),
    onEvent: (event: EventEnvelope, info) => {
      const at = new Date().toISOString();
      const webhookId = requestContext.getStore()?.webhookId;
      const checks =
        info.subscription.mode === "webhook" ? "signature=ok" : "-";
      if (ctx.json) {
        record({
          type: "event",
          at,
          mode: info.subscription.mode,
          webhookId: webhookId ?? null,
          checks,
          event,
        });
      } else {
        line(formatEventLine(at, event, [webhookId ?? "-", checks]));
      }
      delivered += 1;
      if (command.count !== undefined && delivered >= command.count) {
        stop.abort();
      }
    },
    onEventsError: (error) => {
      failure = error;
      stop.abort();
    },
  });

  let listener: { url: string; close(): Promise<void> } | undefined;
  if (webhook) {
    const { listenForEvents } = await loadClientWebhooks();
    const handler = manager.createWebhookHandler();
    listener = await listenForEvents({
      ...(command.port !== undefined ? { port: command.port } : {}),
      tunnel: command.tunnel,
      handler: (request) =>
        requestContext.run(
          { webhookId: request.headers.get("webhook-id") ?? "-" },
          () => handler(request)
        ),
    });
    receiverUrl = listener.url;
  }

  try {
    const sub = await manager.subscribe(
      ctx.server,
      command.name,
      command.args,
      {
        ...(command.mode !== undefined ? { mode: command.mode } : {}),
        ...(command.cursor !== undefined ? { cursor: command.cursor } : {}),
        ...(command.maxAgeMs !== undefined
          ? { maxAgeMs: command.maxAgeMs }
          : {}),
        onGap: (gap) => {
          if (ctx.json)
            record({ type: "gap", cursor: gap.cursor, reason: gap.reason });
          else
            line(
              `${new Date().toISOString()} gap ${gap.reason} cursor=${gap.cursor ?? "-"}`
            );
        },
        onTerminated: (t) => {
          if (ctx.json)
            record({ type: "terminated", kind: t.kind, code: t.code });
          else
            line(`${new Date().toISOString()} terminated ${t.kind} ${t.code}`);
          exitCode = EXIT_TERMINATED;
          stop.abort();
        },
      }
    );
    const ready = {
      type: "listening",
      name: command.name,
      mode: sub.mode,
      ...(receiverUrl !== undefined ? { receiverUrl } : {}),
    };
    if (ctx.json) record(ready);
    else
      process.stderr.write(
        `Listening for ${command.name} (${sub.mode})${receiverUrl ? ` at ${receiverUrl}` : ""}. Press Ctrl+C to stop.\n`
      );
    await untilStopped(stop.signal);
    // A webhook subscription made for this session is removed; poll and push
    // have no server-side state to clean up.
    if (sub.mode === "webhook") await sub.cancel().catch(() => undefined);
    else await sub.close();
  } finally {
    await manager.close().catch(() => undefined);
    await listener?.close().catch(() => undefined);
  }
  if (failure !== undefined) {
    const code = (failure as { code?: unknown }).code;
    throw new CommandError(
      typeof code === "string" ? `events_${code}` : "events_listen_failed",
      failure.message
    );
  }
  return exitCode;
}

/** A receiver behind `listenForEvents` (optionally tunnelled) for `check --tunnel`. */
async function tunnelReceiver(): Promise<ReceiverHandle> {
  const { listenForEvents } = await loadClientWebhooks();
  type Delivery = { headers: Headers; body: Uint8Array; json: unknown };
  const received: Delivery[] = [];
  const waiters: Array<{
    predicate: (d: Delivery) => boolean;
    resolve: (d: Delivery) => void;
  }> = [];
  const listener = await listenForEvents({
    tunnel: true,
    handler: async (request) => {
      const body = new Uint8Array(await request.arrayBuffer());
      let json: unknown;
      try {
        json = JSON.parse(new TextDecoder().decode(body));
      } catch {
        json = undefined;
      }
      const delivery = { headers: request.headers, body, json };
      const index = waiters.findIndex((w) => w.predicate(delivery));
      if (index >= 0) waiters.splice(index, 1)[0]!.resolve(delivery);
      else received.push(delivery);
      return new Response(null, { status: 200 });
    },
  });
  return {
    url: listener.url,
    next(predicate, timeoutMs) {
      const index = received.findIndex(predicate);
      if (index >= 0) return Promise.resolve(received.splice(index, 1)[0]!);
      return new Promise((resolve, reject) => {
        const waiter = {
          predicate,
          resolve: (d: Delivery) => {
            clearTimeout(timer);
            resolve(d);
          },
        };
        const timer = setTimeout(() => {
          const at = waiters.indexOf(waiter);
          if (at >= 0) waiters.splice(at, 1);
          reject(new Error(`no delivery within ${timeoutMs} ms`));
        }, timeoutMs);
        waiters.push(waiter);
      });
    },
    close: () => listener.close(),
  };
}

async function check(
  ctx: ClientEventsContext,
  command: Extract<EventsCommand, { op: "check" }>
): Promise<number> {
  const conformance = await loadConformance();
  const receiver = command.tunnel ? await tunnelReceiver() : undefined;
  let report;
  try {
    report = await conformance.runConformance({
      url: ctx.url,
      dialects: command.dialects,
      headers: ctx.headers,
      mcpName: command.mcpName,
      ...(receiver !== undefined ? { receiver } : {}),
      ...(command.only !== undefined ? { only: command.only } : {}),
    });
  } finally {
    await receiver?.close().catch(() => undefined);
  }
  const format =
    ctx.json && command.format === "text" ? "json" : command.format;
  const rendered =
    format === "junit"
      ? conformance.toJUnit(report)
      : format === "json"
        ? JSON.stringify(
            report,
            null,
            command.out !== undefined ? 2 : undefined
          )
        : formatConformanceText(report);
  if (command.out !== undefined) {
    await writeFile(command.out, `${rendered}\n`, "utf8");
    const s = report.summary;
    process.stderr.write(
      `Wrote ${command.out}: ${s.passed} passed, ${s.mustFailed} MUST failed, ${s.shouldFailed} SHOULD failed, ${s.skipped} skipped\n`
    );
  } else {
    line(rendered);
  }
  return report.summary.mustFailed > 0 ? 1 : 0;
}
