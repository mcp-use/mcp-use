/**
 * The process catalog (`EventsRegistry`) with the §7.1.3 registration checks.
 *
 * Registration is synchronous: every check throws {@link EventsConfigError}
 * with a stable `code` before the server starts. JSON Schemas are produced
 * once, here, from the Standard Schema JSON export (`~standard.jsonSchema`),
 * so `events/list` and the catalog record never convert a schema again.
 *
 * @internal
 */

import { canonicalJson } from "./canonical-json.js";
import type { EventsConfig } from "./config.js";
import { EVENTS_DEFAULTS } from "./config.js";
import { EventsConfigError } from "./config-error.js";
import type { EventsRegistry, RegisteredEvent } from "./internal/registry.js";
import type {
  AnyEventDefinition,
  Duration,
  EventSchema,
  MatchContext,
  SubscriptionInfo,
  UnsubscribeReason,
} from "./types.js";

/** A mutable registry the server fills before start. */
export interface MutableEventsRegistry extends EventsRegistry {
  /** Validate and add; throws `EventsConfigError`. */
  add(definition: AnyEventDefinition): RegisteredEvent;
}

/** Server facts the registration checks read (§7.1.2). */
export interface RegistryOptions {
  /** `ServerConfig.events`, for the server-wide replay default and mode switches. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- user type erased
  config?: EventsConfig<any> | undefined;
}

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SCALAR_TYPES = new Set(["string", "number", "integer", "boolean"]);
const DURATION_UNITS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/**
 * Parse a {@link Duration} (`250`, `"30s"`, `"5m"`, `"1h"`, `"7d"`) to milliseconds.
 *
 * @param value - The duration.
 * @returns Milliseconds, or `undefined` when the value is not a duration.
 */
export function parseDurationMs(
  value: Duration | undefined
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/.exec(value);
  if (match === null) return undefined;
  return Number(match[1]) * DURATION_UNITS[match[2]!]!;
}

/**
 * A synchronous, runtime-neutral 64-bit FNV-1a hash rendered as 16 hex
 * characters. Used for schema and catalog hashes, which only need to detect
 * change (not resist collisions from an attacker).
 */
export function fnv1a64(text: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

type JsonSchemaExport = {
  input?: (options: { target: string }) => Record<string, unknown>;
  output?: (options: { target: string }) => Record<string, unknown>;
};

function toJsonSchema(
  eventName: string,
  field: "inputSchema" | "payloadSchema",
  schema: EventSchema | undefined,
  direction: "input" | "output"
): Record<string, unknown> {
  if (schema === undefined) {
    return { type: "object", properties: {}, additionalProperties: false };
  }
  const exporter = (
    schema["~standard"] as { jsonSchema?: JsonSchemaExport } | undefined
  )?.jsonSchema;
  const convert = exporter?.[direction];
  if (typeof convert !== "function") {
    throw new EventsConfigError(
      "EVENT_SCHEMA_UNSUPPORTED",
      `${eventName}: ${field} has no JSON Schema export. Use a Standard Schema with JSON (for example zod 4).`,
      { name: eventName, field }
    );
  }
  let converted: Record<string, unknown>;
  try {
    converted = convert.call(exporter, { target: "draft-2020-12" });
  } catch (error) {
    throw new EventsConfigError(
      "EVENT_SCHEMA_UNSUPPORTED",
      `${eventName}: ${field} cannot be converted to JSON Schema (${(error as Error).message}).`,
      { name: eventName, field }
    );
  }
  const { $schema: _ignored, ...rest } = converted;
  void _ignored;
  if (rest.type === "object" && !("additionalProperties" in rest)) {
    rest.additionalProperties = false;
  }
  return rest;
}

function propertiesOf(
  schema: Record<string, unknown>
): Record<string, Record<string, unknown>> {
  const props = schema.properties;
  return props !== null && typeof props === "object"
    ? (props as Record<string, Record<string, unknown>>)
    : {};
}

function isScalarProperty(prop: Record<string, unknown> | undefined): boolean {
  if (prop === undefined) return false;
  if ("const" in prop) return true;
  if (Array.isArray(prop.enum)) return true;
  const type = prop.type;
  if (typeof type === "string") return SCALAR_TYPES.has(type);
  if (Array.isArray(type)) {
    const nonNull = (type as unknown[]).filter(
      (t): t is string => typeof t === "string" && t !== "null"
    );
    return nonNull.length > 0 && nonNull.every((t) => SCALAR_TYPES.has(t));
  }
  for (const key of ["anyOf", "oneOf"] as const) {
    const alternatives = prop[key];
    if (Array.isArray(alternatives)) {
      return alternatives.every(
        (alt) =>
          (alt as Record<string, unknown>).type === "null" ||
          isScalarProperty(alt as Record<string, unknown>)
      );
    }
  }
  return false;
}

function resolveReplay(
  def: AnyEventDefinition,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- user type erased
  config: EventsConfig<any> | undefined
): false | { maxAgeMs: number; maxEvents: number } {
  const declared = def.replay !== undefined ? def.replay : config?.replay;
  if (declared === false) return false;
  const [minAge, maxAge] = EVENTS_DEFAULTS.replayMaxAgeBoundsMs;
  const [minEvents, maxEvents] = EVENTS_DEFAULTS.replayMaxEventsBounds;
  const maxAgeMs =
    declared?.maxAge !== undefined
      ? parseDurationMs(declared.maxAge)
      : EVENTS_DEFAULTS.replayMaxAgeMs;
  const events = declared?.maxEvents ?? EVENTS_DEFAULTS.replayMaxEvents;
  if (maxAgeMs === undefined || maxAgeMs < minAge || maxAgeMs > maxAge) {
    throw new EventsConfigError(
      "EVENT_REPLAY_INVALID",
      `${def.name}: replay.maxAge must be between 1m and 30d (got ${String(declared?.maxAge)}).`,
      { name: def.name, field: "replay.maxAge" }
    );
  }
  if (!Number.isInteger(events) || events < minEvents || events > maxEvents) {
    throw new EventsConfigError(
      "EVENT_REPLAY_INVALID",
      `${def.name}: replay.maxEvents must be an integer between 1 and 100000 (got ${String(events)}).`,
      { name: def.name, field: "replay.maxEvents" }
    );
  }
  return { maxAgeMs, maxEvents: events };
}

function checkDeliveryModes(
  def: AnyEventDefinition,
  replay: false | object,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- user type erased
  config: EventsConfig<any> | undefined
): void {
  const delivery = def.delivery ?? {};
  if (replay === false && delivery.poll === true) {
    throw new EventsConfigError(
      "EVENT_POLL_REQUIRES_REPLAY",
      `${def.name}: delivery.poll is true but replay is false. Poll reads the event log, so enable replay or drop delivery.poll.`,
      { name: def.name }
    );
  }
  const webhook = delivery.webhook !== false;
  const push = delivery.push !== false && config?.push?.enabled !== false;
  const poll =
    replay !== false &&
    delivery.poll !== false &&
    config?.poll?.enabled !== false;
  if (!webhook && !push && !poll) {
    throw new EventsConfigError(
      "EVENT_NO_DELIVERY_MODE",
      `${def.name}: no delivery mode remains (webhook, push and poll are all off or impossible by configuration).`,
      { name: def.name }
    );
  }
}

async function runValidate(
  schema: EventSchema,
  value: unknown
): Promise<{ ok: true; value: unknown } | { ok: false; issues: unknown }> {
  const result = (await schema["~standard"].validate(value)) as {
    value?: unknown;
    issues?: unknown;
  };
  if (result.issues !== undefined) return { ok: false, issues: result.issues };
  return { ok: true, value: result.value };
}

function scalarEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return typeof a === "number" && typeof b === "number" && a === b;
}

/**
 * Validate one definition and build its {@link RegisteredEvent}.
 * Throws `EventsConfigError` per §7.1.3. Does not check for duplicates.
 *
 * @param definition - The event definition.
 * @param options - Server facts.
 */
export function buildRegisteredEvent(
  definition: AnyEventDefinition,
  options: RegistryOptions = {}
): RegisteredEvent {
  const def = definition;
  const name = def?.name;
  if (
    typeof name !== "string" ||
    !NAME_PATTERN.test(name) ||
    name.startsWith("mcp.")
  ) {
    throw new EventsConfigError(
      "EVENT_NAME_INVALID",
      `Event name ${JSON.stringify(name)} is invalid: use 1-128 characters [A-Za-z0-9._:-], starting with a letter or digit, and not starting with "mcp.".`,
      { name }
    );
  }
  if (def.payloadSchema === undefined) {
    throw new EventsConfigError(
      "EVENT_SCHEMA_UNSUPPORTED",
      `${name}: payloadSchema is required.`,
      { name, field: "payloadSchema" }
    );
  }
  const inputJsonSchema = toJsonSchema(
    name,
    "inputSchema",
    def.inputSchema as EventSchema | undefined,
    "input"
  );
  const payloadJsonSchema = toJsonSchema(
    name,
    "payloadSchema",
    def.payloadSchema as EventSchema,
    "output"
  );
  const inputProps = propertiesOf(inputJsonSchema);
  const payloadProps = propertiesOf(payloadJsonSchema);
  const customMatch = typeof def.match === "function" ? def.match : undefined;

  if (customMatch === undefined) {
    for (const arg of Object.keys(inputProps)) {
      if (!isScalarProperty(payloadProps[arg])) {
        throw new EventsConfigError(
          "EVENT_ARGUMENT_UNMATCHED",
          `${name}: argument "${arg}" is not in payloadSchema, so it cannot be matched automatically. Add match(args, data) or rename the field.`,
          { name, argument: arg }
        );
      }
    }
  }

  let partitionBy: string | null = null;
  if (def.partitionBy !== undefined) {
    const key = def.partitionBy as string;
    if (
      !isScalarProperty(inputProps[key]) ||
      !isScalarProperty(payloadProps[key])
    ) {
      throw new EventsConfigError(
        "EVENT_PARTITION_INVALID",
        `${name}: partitionBy "${key}" must be a scalar property of both inputSchema and payloadSchema.`,
        { name, partitionBy: key }
      );
    }
    partitionBy = key;
  }

  const replay = resolveReplay(def, options.config);
  checkDeliveryModes(def, replay, options.config);

  const schemaHash = fnv1a64(
    canonicalJson({ input: inputJsonSchema, payload: payloadJsonSchema })
  );

  return {
    name,
    definition: def,
    inputJsonSchema,
    payloadJsonSchema,
    schemaHash,
    replay,
    partitionBy,
    hooks: {
      onSubscribe: typeof def.onSubscribe === "function",
      onUnsubscribe: typeof def.onUnsubscribe === "function",
    },
    async validatePayload(data: unknown): Promise<unknown> {
      const result = await runValidate(def.payloadSchema as EventSchema, data);
      if (!result.ok) {
        throw new EventsConfigError(
          "EVENT_PAYLOAD_INVALID",
          `${name}: payload does not match payloadSchema.`,
          { name, issues: result.issues }
        );
      }
      return result.value;
    },
    async match(
      args: Record<string, unknown>,
      data: unknown,
      ctx: MatchContext
    ): Promise<boolean> {
      if (customMatch !== undefined) {
        return (await customMatch(args, data, ctx)) === true;
      }
      const record = (data ?? {}) as Record<string, unknown>;
      for (const [key, value] of Object.entries(args)) {
        if (value === undefined || value === null) continue;
        if (!scalarEquals(value, record[key])) return false;
      }
      return true;
    },
    async runOnUnsubscribe(
      sub: SubscriptionInfo<Record<string, unknown>>,
      reason: UnsubscribeReason
    ): Promise<void> {
      if (typeof def.onUnsubscribe === "function") {
        await def.onUnsubscribe(sub, reason);
      }
    },
  };
}

/**
 * Create an empty registry.
 *
 * @param options - Server facts the registration checks read.
 */
export function createEventsRegistry(
  options: RegistryOptions = {}
): MutableEventsRegistry {
  const events = new Map<string, RegisteredEvent>();
  let catalogHash: string | undefined;
  return {
    get size() {
      return events.size;
    },
    get(name: string) {
      return events.get(name);
    },
    all() {
      return [...events.values()];
    },
    get catalogHash() {
      catalogHash ??= fnv1a64(
        canonicalJson(
          [...events.values()]
            .map((e) => [e.name, e.schemaHash])
            .sort((a, b) => (a[0]! < b[0]! ? -1 : 1))
        )
      );
      return catalogHash;
    },
    add(definition: AnyEventDefinition): RegisteredEvent {
      if (typeof definition?.name === "string" && events.has(definition.name)) {
        throw new EventsConfigError(
          "EVENT_DUPLICATE",
          `Event "${definition.name}" is already registered.`,
          { name: definition.name }
        );
      }
      const registered = buildRegisteredEvent(definition, options);
      events.set(registered.name, registered);
      catalogHash = undefined;
      return registered;
    },
  };
}
