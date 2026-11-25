/**
 * Argument grammar of `mcp-use client <server> events …` (PLAN.md §11.3).
 * Every command is parsed and validated before any network call, so grammar
 * mistakes exit 2 without connecting.
 *
 * @internal
 */

import { parseArgs } from "node:util";

import { UsageError } from "../../core/errors.js";
import type { ConformanceProfile, DeliveryMode } from "./types.js";

/** Lane dialects accepted by `--dialect` outside `check`. */
export type LaneDialectFlag = "auto" | "sep-3415" | "chatgpt";

/** Options shared by commands that address one subscription. */
export interface SubscriptionTarget {
  /** Event name. */
  name: string;
  /** Subscription arguments (`--args`, a JSON object). */
  args: Record<string, unknown>;
  /** Lane dialect. */
  dialect: LaneDialectFlag;
}

/** A parsed `events` command. */
export type EventsCommand =
  | { op: "list"; dialect: LaneDialectFlag }
  | (SubscriptionTarget & {
      op: "subscribe";
      url: string;
      secret?: string;
      ttlMs?: number;
      cursor?: string | null;
      maxAgeMs?: number;
    })
  | (SubscriptionTarget & { op: "unsubscribe"; url: string })
  | (SubscriptionTarget & {
      op: "listen";
      mode?: DeliveryMode;
      tunnel: boolean;
      port?: number;
      cursor?: string | null;
      maxAgeMs?: number;
      count?: number;
    })
  | (SubscriptionTarget & {
      op: "poll";
      cursor?: string | null;
      maxAgeMs?: number;
      maxEvents?: number;
      follow: boolean;
    })
  | (SubscriptionTarget & {
      op: "stream";
      cursor?: string | null;
      maxAgeMs?: number;
      heartbeatMs?: number;
    })
  | {
      op: "check";
      dialects: ConformanceProfile[];
      only?: string[];
      mcpName: "lenient" | "strict";
      tunnel: boolean;
      format: "text" | "json" | "junit";
      out?: string;
    };

/** The operations, in help order. */
export const EVENTS_OPERATIONS = [
  "list",
  "subscribe",
  "unsubscribe",
  "listen",
  "poll",
  "stream",
  "check",
] as const;

const UNITS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/**
 * Parse a duration such as `500ms`, `30s`, `10m`, `1h`, `7d`, or a bare
 * number of milliseconds.
 *
 * @param raw - The flag value.
 * @param flag - The flag name, for the error.
 * @returns Milliseconds.
 * @throws {@link UsageError} On a malformed or negative value.
 */
export function parseDuration(raw: string, flag: string): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/.exec(raw.trim());
  if (match === null) {
    throw new UsageError(
      `${flag} must be a duration such as 30s, 10m or 1h (got ${raw})`
    );
  }
  return Math.round(Number(match[1]) * UNITS[match[2] ?? "ms"]!);
}

function positiveInteger(raw: string, flag: string): number {
  if (!/^\d+$/.test(raw) || Number(raw) < 1) {
    throw new UsageError(`${flag} must be a positive integer (got ${raw})`);
  }
  return Number(raw);
}

function parseArgsJson(raw: string | undefined): Record<string, unknown> {
  if (raw === undefined) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new UsageError(`--args must be a JSON object (got ${raw})`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new UsageError(`--args must be a JSON object (got ${raw})`);
  }
  return value as Record<string, unknown>;
}

function parseLaneDialect(raw: string | undefined): LaneDialectFlag {
  if (raw === undefined) return "auto";
  if (raw === "auto" || raw === "sep-3415" || raw === "chatgpt") return raw;
  throw new UsageError(
    `--dialect must be auto, sep-3415 or chatgpt (got ${raw})`
  );
}

function parseMode(raw: string | undefined): DeliveryMode | undefined {
  if (raw === undefined) return undefined;
  if (raw === "webhook" || raw === "push" || raw === "poll") return raw;
  throw new UsageError(`--mode must be webhook, push or poll (got ${raw})`);
}

function parseCursor(raw: string): string | null {
  // `--cursor null` asks for "from now" explicitly.
  return raw === "null" ? null : raw;
}

function parseProfiles(raw: string | undefined): ConformanceProfile[] {
  if (raw === undefined) return ["openai", "sep-3415"];
  const out: ConformanceProfile[] = [];
  for (const part of raw.split(",").map((p) => p.trim())) {
    const profile =
      part === "chatgpt" ? "openai" : (part as ConformanceProfile | string);
    if (profile !== "openai" && profile !== "sep-3415") {
      throw new UsageError(
        `--dialect for check takes openai and/or sep-3415 (got ${part})`
      );
    }
    if (!out.includes(profile)) out.push(profile);
  }
  if (out.length === 0) {
    throw new UsageError("--dialect for check needs at least one profile");
  }
  return out;
}

function eventName(
  positionals: readonly string[],
  server: string,
  op: string
): string {
  if (positionals.length !== 1 || positionals[0] === "") {
    throw new UsageError(
      `Usage: mcp-use client ${server} events ${op} <event> [options]`
    );
  }
  return positionals[0]!;
}

/**
 * Parse `mcp-use client <server> events <op> …`.
 *
 * @param server - Saved server name, for usage messages.
 * @param argv - Tokens after `events` (`--json` already removed).
 * @returns The command.
 * @throws {@link UsageError} On any grammar mistake (exit 2).
 */
export function parseEventsCommand(
  server: string,
  argv: readonly string[]
): EventsCommand {
  const op = argv[0];
  const rest = [...argv.slice(1)];
  const usage = `Usage: mcp-use client ${server} events <${EVENTS_OPERATIONS.join("|")}> ...`;
  switch (op) {
    case "list": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        strict: true,
        options: { dialect: { type: "string" } },
      });
      if (positionals.length !== 0) {
        throw new UsageError(`Usage: mcp-use client ${server} events list`);
      }
      return { op, dialect: parseLaneDialect(values.dialect) };
    }
    case "subscribe": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        strict: true,
        options: {
          args: { type: "string" },
          url: { type: "string" },
          secret: { type: "string" },
          ttl: { type: "string" },
          cursor: { type: "string" },
          "max-age": { type: "string" },
          dialect: { type: "string" },
        },
      });
      const name = eventName(positionals, server, op);
      if (values.url === undefined) {
        throw new UsageError(
          `events subscribe needs --url <callback>: the webhook receiver the server delivers to. Use \`events listen\` to receive locally.`
        );
      }
      assertHttpUrl(values.url, "--url");
      return {
        op,
        name,
        args: parseArgsJson(values.args),
        dialect: parseLaneDialect(values.dialect),
        url: values.url,
        ...(values.secret !== undefined ? { secret: values.secret } : {}),
        ...(values.ttl !== undefined
          ? { ttlMs: parseDuration(values.ttl, "--ttl") }
          : {}),
        ...(values.cursor !== undefined
          ? { cursor: parseCursor(values.cursor) }
          : {}),
        ...(values["max-age"] !== undefined
          ? { maxAgeMs: parseDuration(values["max-age"], "--max-age") }
          : {}),
      };
    }
    case "unsubscribe": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        strict: true,
        options: {
          args: { type: "string" },
          url: { type: "string" },
          dialect: { type: "string" },
        },
      });
      const name = eventName(positionals, server, op);
      if (values.url === undefined) {
        throw new UsageError("events unsubscribe needs --url <callback>");
      }
      assertHttpUrl(values.url, "--url");
      return {
        op,
        name,
        args: parseArgsJson(values.args),
        dialect: parseLaneDialect(values.dialect),
        url: values.url,
      };
    }
    case "listen": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        strict: true,
        options: {
          args: { type: "string" },
          mode: { type: "string" },
          tunnel: { type: "boolean" },
          port: { type: "string" },
          cursor: { type: "string" },
          "max-age": { type: "string" },
          count: { type: "string" },
          dialect: { type: "string" },
        },
      });
      const name = eventName(positionals, server, op);
      const mode = parseMode(values.mode);
      if (values.tunnel === true && mode !== undefined && mode !== "webhook") {
        throw new UsageError("--tunnel only applies to --mode webhook");
      }
      return {
        op,
        name,
        args: parseArgsJson(values.args),
        dialect: parseLaneDialect(values.dialect),
        ...(mode !== undefined ? { mode } : {}),
        tunnel: values.tunnel === true,
        ...(values.port !== undefined
          ? { port: positiveInteger(values.port, "--port") }
          : {}),
        ...(values.cursor !== undefined
          ? { cursor: parseCursor(values.cursor) }
          : {}),
        ...(values["max-age"] !== undefined
          ? { maxAgeMs: parseDuration(values["max-age"], "--max-age") }
          : {}),
        ...(values.count !== undefined
          ? { count: positiveInteger(values.count, "--count") }
          : {}),
      };
    }
    case "poll": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        strict: true,
        options: {
          args: { type: "string" },
          cursor: { type: "string" },
          "max-age": { type: "string" },
          "max-events": { type: "string" },
          follow: { type: "boolean" },
          dialect: { type: "string" },
        },
      });
      const name = eventName(positionals, server, op);
      return {
        op,
        name,
        args: parseArgsJson(values.args),
        dialect: parseLaneDialect(values.dialect),
        follow: values.follow === true,
        ...(values.cursor !== undefined
          ? { cursor: parseCursor(values.cursor) }
          : {}),
        ...(values["max-age"] !== undefined
          ? { maxAgeMs: parseDuration(values["max-age"], "--max-age") }
          : {}),
        ...(values["max-events"] !== undefined
          ? {
              maxEvents: positiveInteger(values["max-events"], "--max-events"),
            }
          : {}),
      };
    }
    case "stream": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        strict: true,
        options: {
          args: { type: "string" },
          cursor: { type: "string" },
          "max-age": { type: "string" },
          heartbeat: { type: "string" },
          dialect: { type: "string" },
        },
      });
      const name = eventName(positionals, server, op);
      return {
        op,
        name,
        args: parseArgsJson(values.args),
        dialect: parseLaneDialect(values.dialect),
        ...(values.cursor !== undefined
          ? { cursor: parseCursor(values.cursor) }
          : {}),
        ...(values["max-age"] !== undefined
          ? { maxAgeMs: parseDuration(values["max-age"], "--max-age") }
          : {}),
        ...(values.heartbeat !== undefined
          ? { heartbeatMs: parseDuration(values.heartbeat, "--heartbeat") }
          : {}),
      };
    }
    case "check": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        strict: true,
        options: {
          dialect: { type: "string" },
          only: { type: "string" },
          "mcp-name": { type: "string" },
          tunnel: { type: "boolean" },
          format: { type: "string" },
          out: { type: "string" },
        },
      });
      if (positionals.length !== 0) {
        throw new UsageError(
          `Usage: mcp-use client ${server} events check [options]`
        );
      }
      const mcpName = values["mcp-name"] ?? "lenient";
      if (mcpName !== "lenient" && mcpName !== "strict") {
        throw new UsageError(
          `--mcp-name must be lenient or strict (got ${mcpName})`
        );
      }
      const format = values.format ?? "text";
      if (format !== "text" && format !== "json" && format !== "junit") {
        throw new UsageError(
          `--format must be text, json or junit (got ${format})`
        );
      }
      const only = values.only
        ?.split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      return {
        op,
        dialects: parseProfiles(values.dialect),
        ...(only !== undefined && only.length > 0 ? { only } : {}),
        mcpName,
        tunnel: values.tunnel === true,
        format,
        ...(values.out !== undefined ? { out: values.out } : {}),
      };
    }
    default:
      throw new UsageError(usage);
  }
}

function assertHttpUrl(raw: string, flag: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UsageError(
      `${flag} must be an absolute http(s) URL (got ${raw})`
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UsageError(
      `${flag} must be an absolute http(s) URL (got ${raw})`
    );
  }
}
