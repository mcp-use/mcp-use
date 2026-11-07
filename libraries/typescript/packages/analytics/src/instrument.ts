/**
 * `instrument()`: detect the server object, resolve settings and hand the
 * object to the matching adapter. Never throws; an unsupported object or a
 * missing key leaves the server untouched.
 */

import {
  AnalyticsClient,
  EXIT_FLUSH_MS,
  type ClientSettings,
  type EventSource,
} from "./client.js";
import { instrumentMcpUse, isMcpUseServer } from "./adapters/mcp-use.js";
import {
  INSTRUMENTED,
  instrumentProtocol,
  isProtocol,
  isV2Protocol,
  sdkFramework,
  serverInfoOf,
  type ProtocolLike,
} from "./adapters/protocol.js";
import { Instrumentation } from "./record.js";
import {
  isTruthyFlag,
  onBeforeExit,
  onTerminationSignal,
  readEnv,
} from "./runtime.js";
import { globalState, warnOncePerProcess } from "./state.js";
import type { AnalyticsOptions, Framework } from "./types.js";

/** Production ingest origin. */
const DEFAULT_ENDPOINT = "https://ingest.run.mcp-use.com";

/**
 * `mcp-handler`'s default `serverInfo.name`, the only trace it leaves on the
 * server; a handler with its own name needs the `framework` option.
 */
const MCP_HANDLER_DEFAULT_NAME = "mcp-typescript server on vercel";

const FRAMEWORKS: ReadonlySet<string> = new Set<Framework>([
  "mcp-sdk-v1",
  "mcp-sdk-v2",
  "skybridge",
  "mcp-handler",
  "mcp-use",
  "mcp-use-v1",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function clamp(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

type Target =
  | { kind: "protocol"; protocol: ProtocolLike; framework: Framework }
  | { kind: "mcp-use" }
  | { kind: "mcp-use-v1"; nativeProtocol: ProtocolLike | undefined }
  | { kind: "skybridge-app" };

function detect(value: Record<string, unknown>): Target | undefined {
  if (
    typeof value["getServerForSession"] === "function" &&
    "nativeServer" in value
  ) {
    const native = value["nativeServer"];
    const nativeProtocol =
      isRecord(native) && isProtocol(native["server"])
        ? native["server"]
        : undefined;
    return { kind: "mcp-use-v1", nativeProtocol };
  }
  if (isMcpUseServer(value)) return { kind: "mcp-use" };
  if (typeof value["createServerInstance"] === "function")
    return { kind: "skybridge-app" };
  const inner = value["server"];
  if (isProtocol(inner)) {
    let framework: Framework = sdkFramework(inner);
    if (typeof value["mcpMiddleware"] === "function") framework = "skybridge";
    else if (
      isV2Protocol(inner) &&
      serverInfoOf(inner)?.name === MCP_HANDLER_DEFAULT_NAME
    ) {
      framework = "mcp-handler";
    }
    return { kind: "protocol", protocol: inner, framework };
  }
  if (isProtocol(value))
    return {
      kind: "protocol",
      protocol: value,
      framework: sdkFramework(value),
    };
  return undefined;
}

/** Resolve settings and return the shared client for them, or undefined when off. */
function resolveClient(options: AnalyticsOptions): AnalyticsClient | undefined {
  const enabled =
    options.enabled ?? !isTruthyFlag(readEnv("MANUFACT_ANALYTICS_DISABLED"));
  if (!enabled) return undefined;

  const apiKey = str(options.apiKey) ?? str(readEnv("MANUFACT_ANALYTICS_KEY"));
  if (apiKey === undefined) {
    warnOncePerProcess(
      "no-key",
      "MANUFACT_ANALYTICS_KEY is not set, so no analytics are recorded. Set it (or pass apiKey) to send this server's traffic to Manufact."
    );
    return undefined;
  }
  if (!apiKey.startsWith("mfi_")) {
    warnOncePerProcess(
      "key-format",
      "the analytics key does not start with mfi_; copy it from the server's Analytics SDK card in the Manufact dashboard."
    );
  }

  const endpoint =
    str(options.endpoint) ??
    str(readEnv("MANUFACT_ANALYTICS_URL")) ??
    DEFAULT_ENDPOINT;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" && url.protocol !== "http:")
      throw new Error("not http(s)");
  } catch {
    warnOncePerProcess(
      "endpoint",
      `the analytics endpoint ${endpoint} is not a valid http(s) URL; nothing is recorded.`
    );
    return undefined;
  }

  const state = globalState();
  if (state.stopped === true) return undefined;
  const key = `${endpoint}\u0000${apiKey}`;
  // A key rejected with 401 stays off until the process restarts; a 402
  // pause recovers by itself.
  const existing = state.clients.get(key);
  if (existing !== undefined) return existing;

  const settings: ClientSettings = {
    apiKey,
    endpoint,
    debug: options.debug === true,
    flushIntervalMs: clamp(options.flushIntervalMs, 1000, 1, 60_000),
    maxBatchSize: clamp(options.maxBatchSize, 100, 1, 500),
    maxQueueSize: clamp(options.maxQueueSize, 1000, 1, 100_000),
  };
  const client = new AnalyticsClient(settings);
  state.clients.set(key, client);
  installExitHook();
  return client;
}

const EXIT_HOOK = Symbol.for("@mcp-use/analytics.exitHook");

/**
 * Flush every client when the process is about to end (installed once per
 * process): when the event loop empties, one short, bounded attempt
 * (`flushOnExit`), never the retry loop, so a stalled endpoint cannot keep a
 * finished process alive; and on SIGINT/SIGTERM in Node and Bun, a flush that
 * starts at once and leaves the signal's effect unchanged (see
 * `onTerminationSignal`).
 */
function installExitHook(): void {
  const holder = globalThis as Record<symbol, unknown>;
  if (holder[EXIT_HOOK] === true) return;
  holder[EXIT_HOOK] = true;
  onBeforeExit(() => {
    for (const client of globalState().clients.values()) {
      if (client.hasWork) void client.flushOnExit();
    }
  });
  onTerminationSignal(async (final) => {
    await Promise.all(
      [...globalState().clients.values()].map((client) =>
        final ? client.flushOnExit() : client.flushOnSignal()
      )
    );
  }, EXIT_FLUSH_MS);
}

function mark(value: object): void {
  Object.defineProperty(value, INSTRUMENTED, { value: true });
}

function sourceFor(
  framework: Framework,
  server: { name?: string; version?: string } | undefined,
  options: AnalyticsOptions
): EventSource {
  // An explicit label wins over detection (mcp-handler with its own name).
  const label =
    typeof options.framework === "string" && FRAMEWORKS.has(options.framework)
      ? options.framework
      : framework;
  return { framework: label, ...(server !== undefined && { server }) };
}

function hooksOf(options: AnalyticsOptions): Instrumentation["hooks"] {
  return {
    ...(options.capturePayloads !== undefined && {
      capturePayloads: options.capturePayloads,
    }),
    ...(options.redact !== undefined && { redact: options.redact }),
    ...(options.identify !== undefined && { identify: options.identify }),
    ...(options.conversationId !== undefined && {
      conversationId: options.conversationId,
    }),
    ...(options.waitUntil !== undefined && { waitUntil: options.waitUntil }),
  };
}

function infoFromConfig(
  value: unknown
): { name?: string; version?: string } | undefined {
  if (!isRecord(value)) return undefined;
  const name = str(value["name"]);
  const version = str(value["version"]);
  if (name === undefined && version === undefined) return undefined;
  return {
    ...(name !== undefined && { name }),
    ...(version !== undefined && { version }),
  };
}

/**
 * Wrap a factory method so every server it returns is instrumented (Skybridge
 * `createServerInstance`, mcp-use v1 `getServerForSession`).
 */
function wrapFactory(
  owner: Record<string, unknown>,
  name: string,
  inst: Instrumentation
): void {
  const original = owner[name] as (...args: unknown[]) => unknown;
  const instrumentResult = (server: unknown): unknown => {
    try {
      const protocol = isProtocol(server)
        ? server
        : isRecord(server) && isProtocol(server["server"])
          ? server["server"]
          : undefined;
      if (protocol !== undefined) instrumentProtocol(protocol, inst);
    } catch (error) {
      inst.client.debug(
        `could not instrument the server from ${name}()`,
        error
      );
    }
    return server;
  };
  owner[name] = function (this: unknown, ...args: unknown[]): unknown {
    const out = original.apply(this, args);
    if (isRecord(out) && typeof out["then"] === "function") {
      return (out as unknown as Promise<unknown>).then(instrumentResult);
    }
    return instrumentResult(out);
  };
}

function instrumentTarget(server: unknown, options: AnalyticsOptions): void {
  if (!isRecord(server)) {
    warnOncePerProcess(
      "unsupported",
      "instrument() expects an MCP server object; nothing is recorded."
    );
    return;
  }
  if ((server as Record<symbol, unknown>)[INSTRUMENTED] === true) return;
  const target = detect(server);
  if (target === undefined) {
    warnOncePerProcess(
      "unsupported",
      "instrument() does not recognize this server object (supported: McpServer and Server from the official SDK v1 and v2, Skybridge, mcp-handler, mcp-use MCPServer); nothing is recorded."
    );
    return;
  }
  const client = resolveClient(options);
  if (client === undefined) return;
  const hooks = hooksOf(options);

  switch (target.kind) {
    case "protocol": {
      const inst = new Instrumentation(
        client,
        sourceFor(target.framework, serverInfoOf(target.protocol), options),
        hooks
      );
      instrumentProtocol(target.protocol, inst);
      mark(server);
      return;
    }
    case "mcp-use": {
      const inst = new Instrumentation(
        client,
        sourceFor("mcp-use", infoFromConfig(server["config"]), options),
        hooks
      );
      if (
        instrumentMcpUse(
          server as unknown as Parameters<typeof instrumentMcpUse>[0],
          inst
        )
      )
        mark(server);
      return;
    }
    case "mcp-use-v1": {
      const inst = new Instrumentation(
        client,
        sourceFor("mcp-use-v1", infoFromConfig(server["config"]), options),
        hooks
      );
      wrapFactory(server, "getServerForSession", inst);
      if (target.nativeProtocol !== undefined)
        instrumentProtocol(target.nativeProtocol, inst);
      mark(server);
      return;
    }
    case "skybridge-app": {
      const inst = new Instrumentation(
        client,
        sourceFor("skybridge", infoFromConfig(server["serverInfo"]), options),
        hooks
      );
      wrapFactory(server, "createServerInstance", inst);
      mark(server);
      return;
    }
    // no default
  }
}

/**
 * Record one analytics event per JSON-RPC request the server handles and
 * send them to Manufact in the background.
 *
 * Supports `McpServer` and `Server` from the official SDK v1
 * (`@modelcontextprotocol/sdk`) and v2 (`@modelcontextprotocol/server`),
 * Skybridge (its `McpServer`, or the `Skybridge` app), Vercel's
 * `mcp-handler` (call it on the server inside the initializer) and mcp-use's
 * `MCPServer` (call it before `listen()`). Calling it again on the same
 * server is a no-op, and it is cheap enough to call on every per-request
 * server.
 *
 * With no key (`MANUFACT_ANALYTICS_KEY` or `apiKey`) it logs one warning and
 * leaves the server untouched. It never throws and never changes what the
 * server returns.
 *
 * @param server - The server object to instrument.
 * @param options - Optional settings; every field has an environment default.
 * @returns The same `server`, for chaining.
 *
 * @example
 * ```ts
 * import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
 * import { instrument } from "@mcp-use/analytics";
 *
 * const server = instrument(new McpServer({ name: "weather", version: "1.0.0" }));
 * ```
 */
export function instrument<T>(server: T, options: AnalyticsOptions = {}): T {
  try {
    instrumentTarget(server, options);
  } catch (error) {
    if (options.debug === true) {
      console.debug(
        "[@mcp-use/analytics] instrument() failed; the server is unchanged",
        error
      );
    }
  }
  return server;
}

/**
 * Send every queued event now. Resolves (never rejects) once they were
 * attempted. Use it before a serverless invocation ends, for example
 * `ctx.waitUntil(flush())` on Cloudflare Workers.
 *
 * @returns A promise that settles when the flush finished.
 */
export async function flush(): Promise<void> {
  await Promise.all(
    [...globalState().clients.values()].map((client) => client.flush())
  );
}

/**
 * Flush queued events, then stop recording for the rest of the process:
 * instrumented servers keep working, and later `instrument()` calls leave
 * their servers untouched.
 *
 * @returns A promise that settles when the final flush finished.
 */
export async function shutdown(): Promise<void> {
  globalState().stopped = true;
  await Promise.all(
    [...globalState().clients.values()].map((client) => client.shutdown())
  );
}
