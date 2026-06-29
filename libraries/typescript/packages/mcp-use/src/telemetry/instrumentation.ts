import { generateUUID } from "../server/utils/runtime.js";

const DEFAULT_MANUFACT_CLOUD_ENDPOINT =
  "https://cloud.manufact.com/api/v1/telemetry/mcp";
const REDACTED_VALUE = "[Redacted]";
const TRUNCATED_VALUE = "[Truncated]";
const BINARY_VALUE = "[Binary]";
const CIRCULAR_VALUE = "[Circular]";
const DEFAULT_MAX_STRING_LENGTH = 2048;
const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_MAX_ARRAY_LENGTH = 50;
const DEFAULT_SENSITIVE_KEY_PATTERNS: readonly RegExp[] = [
  /^authorization$/i,
  /^cookie$/i,
  /token/i,
  /secret/i,
  /password/i,
  /api[-_]?key/i,
];

export type McpInstrumentationEventName =
  | "mcp.server.started"
  | "mcp.server.stopped"
  | "mcp.initialize"
  | "mcp.session.closed"
  | "mcp.tools.list"
  | "mcp.resources.list"
  | "mcp.prompts.list"
  | "mcp.tool.call"
  | "mcp.resource.read"
  | "mcp.prompt.get"
  | "mcp.sampling.request"
  | "mcp.elicitation.request"
  | "mcp.notification.sent"
  | "mcp.error";

export interface McpInstrumentationEvent {
  eventId: string;
  name: McpInstrumentationEventName;
  timestamp: string;
  server?: { name?: string; version?: string };
  transport?: string;
  session?: { id?: string };
  client?: { name?: string; version?: string };
  actor?: { subject?: string; roles?: string[] };
  method?: string;
  resourceName?: string;
  durationMs?: number;
  success?: boolean;
  error?: { name?: string; message?: string; code?: string };
  requestSize?: number;
  responseSize?: number;
  payloads?: { request?: unknown; response?: unknown };
  attributes?: Record<string, unknown>;
}

export interface ServerInstrumentationContext {
  server?: { name?: string; version?: string };
}

export interface McpInstrumentationAdapter {
  name: string;
  setup?(ctx: ServerInstrumentationContext): void | Promise<void>;
  onEvent(event: McpInstrumentationEvent): void | Promise<void>;
  flush?(): void | Promise<void>;
  shutdown?(): void | Promise<void>;
}

export interface InstrumentationPayloadSanitizerOptions {
  capturePayloads?: boolean;
  sensitiveKeys?: readonly (RegExp | string)[];
  maxStringLength?: number;
  maxDepth?: number;
  maxArrayLength?: number;
}

interface NormalizedInstrumentationPayloadSanitizerOptions {
  capturePayloads: boolean;
  sensitiveKeys: readonly RegExp[];
  maxStringLength: number;
  maxDepth: number;
  maxArrayLength: number;
}

export interface ManufactCloudInstrumentationOptions {
  serverId: string;
  writeKey: string;
  endpoint?: string;
  fetch?: typeof fetch;
  flushAt?: number;
  capturePayloads?: boolean;
  sanitizer?: InstrumentationPayloadSanitizerOptions;
}

export interface ManufactCloudInstrumentationPayload {
  event_id: string;
  event: McpInstrumentationEventName;
  timestamp: string;
  server_id: string;
  server?: McpInstrumentationEvent["server"];
  transport?: string;
  session?: McpInstrumentationEvent["session"];
  client?: McpInstrumentationEvent["client"];
  actor?: McpInstrumentationEvent["actor"];
  method?: string;
  resource_name?: string;
  duration_ms?: number;
  success?: boolean;
  error?: McpInstrumentationEvent["error"];
  request_size?: number;
  response_size?: number;
  payloads?: McpInstrumentationEvent["payloads"];
  attributes?: McpInstrumentationEvent["attributes"];
}

export interface PostHogCapturePayload {
  event: string;
  distinctId: string;
  properties: Record<string, unknown>;
}

export interface PostHogLikeClient {
  capture(payload: PostHogCapturePayload): void | Promise<void>;
  flush?(): void | Promise<void>;
  shutdown?(): void | Promise<void>;
}

export interface PostHogInstrumentationOptions {
  capturePayloads?: boolean;
  sanitizer?: InstrumentationPayloadSanitizerOptions;
  distinctId?:
    | string
    | ((event: McpInstrumentationEvent) => string | undefined);
  groups?:
    | Record<string, string | number>
    | ((
        event: McpInstrumentationEvent
      ) => Record<string, string | number> | undefined);
  beforeSend?(
    payload: PostHogCapturePayload,
    event: McpInstrumentationEvent
  ):
    | PostHogCapturePayload
    | false
    | null
    | Promise<PostHogCapturePayload | false | null>;
}

export interface InstrumentationManagerOptions extends ServerInstrumentationContext {
  adapters?: McpInstrumentationAdapter[];
}

export class InstrumentationManager {
  private readonly adapters: McpInstrumentationAdapter[];
  private readonly context: ServerInstrumentationContext;

  constructor(options: InstrumentationManagerOptions = {}) {
    this.adapters = options.adapters ?? [];
    this.context = { server: options.server };
  }

  async setup(): Promise<void> {
    await Promise.all(
      this.adapters.map((adapter) => adapter.setup?.(this.context))
    );
  }

  async emit(
    event: Omit<McpInstrumentationEvent, "eventId" | "timestamp"> &
      Partial<Pick<McpInstrumentationEvent, "eventId" | "timestamp">>
  ): Promise<void> {
    const normalized: McpInstrumentationEvent = {
      eventId: event.eventId ?? generateUUID(),
      timestamp: event.timestamp ?? new Date().toISOString(),
      server: event.server ?? this.context.server,
      ...event,
    };

    await Promise.all(
      this.adapters.map((adapter) => adapter.onEvent(normalized))
    );
  }

  async flush(): Promise<void> {
    await Promise.all(this.adapters.map((adapter) => adapter.flush?.()));
  }

  async shutdown(): Promise<void> {
    await Promise.all(this.adapters.map((adapter) => adapter.shutdown?.()));
  }
}

export function sanitizeInstrumentationEvent(
  event: McpInstrumentationEvent,
  options: InstrumentationPayloadSanitizerOptions = {}
): McpInstrumentationEvent {
  const normalizedOptions = normalizeSanitizerOptions(options);
  const sanitized: McpInstrumentationEvent = { ...event, payloads: undefined };

  if (event.error !== undefined) {
    sanitized.error = sanitizeValue(
      event.error,
      normalizedOptions,
      0,
      new WeakSet<object>()
    ) as McpInstrumentationEvent["error"];
  }

  if (event.attributes !== undefined) {
    sanitized.attributes = sanitizeValue(
      event.attributes,
      normalizedOptions,
      0,
      new WeakSet<object>()
    ) as McpInstrumentationEvent["attributes"];
  }

  if (normalizedOptions.capturePayloads && event.payloads !== undefined) {
    sanitized.payloads = sanitizeValue(
      event.payloads,
      normalizedOptions,
      0,
      new WeakSet<object>()
    ) as McpInstrumentationEvent["payloads"];
  }

  return sanitized;
}

export function manufactCloud(
  options: ManufactCloudInstrumentationOptions
): McpInstrumentationAdapter {
  if (!options.serverId) {
    throw new Error("manufactCloud() requires a serverId");
  }

  if (!options.writeKey) {
    throw new Error("manufactCloud() requires a writeKey");
  }

  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("manufactCloud() requires fetch to be available");
  }

  const endpoint = options.endpoint ?? DEFAULT_MANUFACT_CLOUD_ENDPOINT;
  const flushAt = Math.max(1, options.flushAt ?? 1);
  const queue: ManufactCloudInstrumentationPayload[] = [];
  let pendingFlush: Promise<void> = Promise.resolve();

  async function sendBatch(
    batch: ManufactCloudInstrumentationPayload[]
  ): Promise<void> {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.writeKey}`,
        "content-type": "application/json",
        "x-mcp-use-server-id": options.serverId,
      },
      body: JSON.stringify({
        server_id: options.serverId,
        batch,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Manufact Cloud instrumentation request failed with ${response.status}`
      );
    }
  }

  async function flush(): Promise<void> {
    if (queue.length === 0) {
      await pendingFlush;
      return;
    }

    const batch = queue.splice(0, queue.length);
    const nextFlush = pendingFlush.then(
      () => sendBatch(batch),
      () => sendBatch(batch)
    );
    pendingFlush = nextFlush.catch(() => undefined);
    await nextFlush;
  }

  return {
    name: "manufact-cloud",
    async onEvent(event) {
      queue.push(
        toManufactCloudPayload(
          sanitizeInstrumentationEvent(event, {
            ...options.sanitizer,
            capturePayloads:
              options.capturePayloads ??
              options.sanitizer?.capturePayloads ??
              false,
          }),
          options.serverId
        )
      );

      if (queue.length >= flushAt) {
        await flush();
      }
    },
    flush,
    shutdown: flush,
  };
}

export function posthogAdapter(
  posthog: PostHogLikeClient,
  options: PostHogInstrumentationOptions = {}
): McpInstrumentationAdapter {
  return {
    name: "posthog",
    async onEvent(event) {
      const payload = toPostHogPayload(
        sanitizeInstrumentationEvent(event, {
          ...options.sanitizer,
          capturePayloads:
            options.capturePayloads ??
            options.sanitizer?.capturePayloads ??
            false,
        }),
        options
      );
      const preparedPayload = options.beforeSend
        ? await options.beforeSend(payload, event)
        : payload;

      if (preparedPayload === false || preparedPayload === null) {
        return;
      }

      await posthog.capture(preparedPayload);
    },
    async flush() {
      await posthog.flush?.();
    },
    async shutdown() {
      await posthog.flush?.();
      await posthog.shutdown?.();
    },
  };
}

function toManufactCloudPayload(
  event: McpInstrumentationEvent,
  serverId: string
): ManufactCloudInstrumentationPayload {
  const payload: ManufactCloudInstrumentationPayload = {
    event_id: event.eventId,
    event: event.name,
    timestamp: event.timestamp,
    server_id: serverId,
  };

  if (event.server !== undefined) payload.server = event.server;
  if (event.transport !== undefined) payload.transport = event.transport;
  if (event.session !== undefined) payload.session = event.session;
  if (event.client !== undefined) payload.client = event.client;
  if (event.actor !== undefined) payload.actor = event.actor;
  if (event.method !== undefined) payload.method = event.method;
  if (event.resourceName !== undefined)
    payload.resource_name = event.resourceName;
  if (event.durationMs !== undefined) payload.duration_ms = event.durationMs;
  if (event.success !== undefined) payload.success = event.success;
  if (event.error !== undefined) payload.error = event.error;
  if (event.requestSize !== undefined) payload.request_size = event.requestSize;
  if (event.responseSize !== undefined)
    payload.response_size = event.responseSize;
  if (event.payloads !== undefined) payload.payloads = event.payloads;
  if (event.attributes !== undefined) payload.attributes = event.attributes;

  return payload;
}

function toPostHogPayload(
  event: McpInstrumentationEvent,
  options: PostHogInstrumentationOptions
): PostHogCapturePayload {
  const groups = resolveGroups(event, options.groups);
  const properties = compactRecord({
    event_id: event.eventId,
    timestamp: event.timestamp,
    mcp_event: event.name,
    server_name: event.server?.name,
    server_version: event.server?.version,
    transport: event.transport,
    session_id: event.session?.id,
    $session_id: event.session?.id,
    client_name: event.client?.name,
    client_version: event.client?.version,
    actor_subject: event.actor?.subject,
    actor_roles: event.actor?.roles,
    method: event.method,
    resource_name: event.resourceName,
    duration_ms: event.durationMs,
    success: event.success,
    error_name: event.error?.name,
    error_message: event.error?.message,
    error_code: event.error?.code,
    request_size: event.requestSize,
    response_size: event.responseSize,
    payloads: event.payloads,
    attributes: event.attributes,
    $groups: groups,
  });

  return {
    event: toPostHogEventName(event.name),
    distinctId: resolveDistinctId(event, options.distinctId),
    properties,
  };
}

function toPostHogEventName(name: McpInstrumentationEventName): string {
  switch (name) {
    case "mcp.initialize":
      return "$mcp_initialize";
    case "mcp.tools.list":
      return "$mcp_tools_list";
    case "mcp.resources.list":
      return "$mcp_resources_list";
    case "mcp.prompts.list":
      return "$mcp_prompts_list";
    case "mcp.tool.call":
      return "$mcp_tool_call";
    case "mcp.resource.read":
      return "$mcp_resource_read";
    case "mcp.prompt.get":
      return "$mcp_prompt_get";
    case "mcp.error":
      return "$exception";
    default:
      return `$${name.replace(/\./g, "_")}`;
  }
}

function resolveDistinctId(
  event: McpInstrumentationEvent,
  distinctId: PostHogInstrumentationOptions["distinctId"]
): string {
  if (typeof distinctId === "function") {
    return (
      distinctId(event) ??
      event.actor?.subject ??
      event.session?.id ??
      "anonymous"
    );
  }

  return distinctId ?? event.actor?.subject ?? event.session?.id ?? "anonymous";
}

function resolveGroups(
  event: McpInstrumentationEvent,
  groups: PostHogInstrumentationOptions["groups"]
): Record<string, string | number> | undefined {
  if (typeof groups === "function") {
    return groups(event);
  }

  return groups;
}

function compactRecord(
  record: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined)
  );
}

function normalizeSanitizerOptions(
  options: InstrumentationPayloadSanitizerOptions
): NormalizedInstrumentationPayloadSanitizerOptions {
  return {
    capturePayloads: options.capturePayloads ?? false,
    sensitiveKeys: [
      ...DEFAULT_SENSITIVE_KEY_PATTERNS,
      ...(options.sensitiveKeys ?? []).map((key) =>
        typeof key === "string" ? new RegExp(escapeRegExp(key), "i") : key
      ),
    ],
    maxStringLength: options.maxStringLength ?? DEFAULT_MAX_STRING_LENGTH,
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
    maxArrayLength: options.maxArrayLength ?? DEFAULT_MAX_ARRAY_LENGTH,
  };
}

function sanitizeValue(
  value: unknown,
  options: NormalizedInstrumentationPayloadSanitizerOptions,
  depth: number,
  seen: WeakSet<object>
): unknown {
  if (depth > options.maxDepth) {
    return TRUNCATED_VALUE;
  }

  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "string") {
    return truncateString(value, options.maxStringLength);
  }

  if (typeof value === "undefined" || typeof value === "function") {
    return undefined;
  }

  if (typeof value === "symbol") {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) ||
    (typeof Blob !== "undefined" && value instanceof Blob)
  ) {
    return BINARY_VALUE;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, options.maxArrayLength)
      .map((item) => sanitizeValue(item, options, depth + 1, seen));
  }

  if (typeof value !== "object") {
    return String(value);
  }

  if (seen.has(value)) {
    return CIRCULAR_VALUE;
  }

  seen.add(value);
  const entries = Object.entries(value);
  const result: Record<string, unknown> = {};

  for (const [key, nestedValue] of entries) {
    if (isSensitiveKey(key, options.sensitiveKeys)) {
      result[key] = REDACTED_VALUE;
      continue;
    }

    const sanitizedValue = sanitizeValue(nestedValue, options, depth + 1, seen);

    if (sanitizedValue !== undefined) {
      result[key] = sanitizedValue;
    }
  }

  seen.delete(value);
  return result;
}

function isSensitiveKey(key: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(key));
}

function truncateString(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
