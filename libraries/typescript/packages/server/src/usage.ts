declare const __MCP_USE_PACKAGE_VERSION__: string;

// Disable at any time with MCP_USE_ANONYMIZED_TELEMETRY=false.

type Value = string | number | boolean;
type Properties = Record<string, Value | undefined>;
type Options = {
  onceKey?: string;
  sampleRate?: number;
  serverRoot?: string;
};

const EVENT = "mcp_use_sdk_event";
const ENDPOINT = "https://eu.i.posthog.com/i/v0/e/";
const TOKEN = "phc_lyTtbYwvkdSbrcMQNPiKiiRWrrM1seyKIMjycSvItEI";
const CONTENT =
  /(^|_)(arguments?|args|body|command|headers?|location|message|organization|path|query|response|secret|subject|token|uri|url|user_agent)(_|$)/i;
const RESERVED = new Set(
  "feature action sdk_generation telemetry_schema_version sdk_package sdk_version server_id runtime_id identity_stability distinct_id validation_run_id is_validation".split(
    " "
  )
);
// Workers prohibit random-value generation while evaluating a module. Usage is
// only recorded from request-time server paths, so allocate this process ID on
// first use instead of making the package unimportable in an edge runtime.
let runtimeId: string | undefined;

function getRuntimeId(): string {
  runtimeId ??= crypto.randomUUID();
  return runtimeId;
}
const once = new Set<string>();
const pending = new Set<Promise<void>>();
const identities = new Map<string, Promise<Identity>>();

interface Identity {
  id: string;
  stability: "project" | "server" | "process";
}

function hasControl(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

function env(name: string): string | undefined {
  return typeof process === "undefined" ? undefined : process.env?.[name];
}

function safeEnv(name: string): string | undefined {
  const value = env(name);
  return value !== undefined &&
    value.length > 0 &&
    value.length <= 128 &&
    !hasControl(value)
    ? value
    : undefined;
}

/**
 * Whether this runtime may persist the anonymous telemetry identity beside the
 * project. Deno exposes Node compatibility APIs but its default edge/runtime
 * permissions intentionally reject writes, so it must use the in-memory
 * isolate identity instead. Workers do not expose `process` at all.
 */
function canPersistTelemetryIdentity(): boolean {
  if (typeof process === "undefined" || process.versions?.node === undefined) {
    return false;
  }
  return !("Deno" in globalThis);
}

function disabled(): boolean {
  if (env("MCP_USE_ANONYMIZED_TELEMETRY") === "false") return true;
  try {
    const scope = globalThis as typeof globalThis & {
      __MCP_USE_ANONYMIZED_TELEMETRY__?: boolean;
    };
    return (
      scope.__MCP_USE_ANONYMIZED_TELEMETRY__ === false ||
      (typeof localStorage !== "undefined" &&
        localStorage.getItem("MCP_USE_ANONYMIZED_TELEMETRY") === "false")
    );
  } catch {
    return false;
  }
}

/** Whether anonymous usage capture is disabled in the current runtime. @internal */
export function isUsageDisabled(): boolean {
  return disabled();
}

function clean(properties: Properties): Properties {
  return Object.fromEntries(
    Object.entries(properties).filter(([key, value]) => {
      if (
        key.length > 128 ||
        hasControl(key) ||
        key.startsWith("$") ||
        RESERVED.has(key) ||
        CONTENT.test(key) ||
        value === undefined
      )
        return false;
      return typeof value === "string"
        ? value.length <= 128 && !hasControl(value)
        : typeof value === "boolean" ||
            (typeof value === "number" && Number.isFinite(value));
    })
  );
}

async function identity(serverRoot?: string): Promise<Identity> {
  const projectId = safeEnv("MCP_USE_TELEMETRY_PROJECT_ID");
  if (projectId !== undefined) return { id: projectId, stability: "project" };
  if (serverRoot === undefined || !canPersistTelemetryIdentity())
    return { id: getRuntimeId(), stability: "process" };
  const existing = identities.get(serverRoot);
  if (existing !== undefined) return existing;
  const resolving = (async (): Promise<Identity> => {
    try {
      const fs = await import("node:fs/promises");
      const directory = `${serverRoot}/.mcp-use`;
      const file = `${directory}/usage.json`;
      const read = async (): Promise<string | undefined> => {
        try {
          const value = JSON.parse(await fs.readFile(file, "utf8")) as unknown;
          if (
            typeof value === "object" &&
            value !== null &&
            "schemaVersion" in value &&
            value.schemaVersion === 1 &&
            "serverId" in value &&
            typeof value.serverId === "string" &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
              value.serverId
            )
          )
            return value.serverId;
        } catch {
          // Missing or malformed state is replaced below.
        }
        return undefined;
      };
      const stored = await read();
      if (stored !== undefined) return { id: stored, stability: "server" };
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const created = crypto.randomUUID();
      try {
        await fs.writeFile(
          file,
          `${JSON.stringify({ schemaVersion: 1, serverId: created })}\n`,
          { flag: "wx", mode: 0o600 }
        );
        return { id: created, stability: "server" };
      } catch {
        const raced = await read();
        if (raced !== undefined) return { id: raced, stability: "server" };
      }
    } catch {
      // Storage is optional; runtime identity remains available.
    }
    return { id: getRuntimeId(), stability: "process" };
  })();
  identities.set(serverRoot, resolving);
  return resolving;
}

function capture(
  feature: string,
  action: string,
  properties: Properties,
  options: Options,
  resolveIdentity: () => Promise<Identity>
): void {
  const validationId = safeEnv("MCP_USE_TELEMETRY_VALIDATION_ID");
  if (
    disabled() ||
    (env("NODE_ENV") === "test" && validationId === undefined) ||
    pending.size >= 16
  )
    return;
  if (options.onceKey !== undefined) {
    if (once.has(options.onceKey)) return;
    once.add(options.onceKey);
  }
  const rate = Math.max(0, Math.min(1, options.sampleRate ?? 1));
  if (validationId === undefined && Math.random() >= rate) return;
  const request = (async () => {
    try {
      const resolvedIdentity = await resolveIdentity();
      const body = JSON.stringify({
        api_key: TOKEN,
        event: EVENT,
        properties: {
          ...clean(properties),
          feature,
          action,
          sdk_generation: "v2",
          telemetry_schema_version: 2,
          sdk_package: "mcp-use",
          sdk_version:
            typeof __MCP_USE_PACKAGE_VERSION__ === "undefined"
              ? "development"
              : __MCP_USE_PACKAGE_VERSION__,
          server_id: resolvedIdentity.id,
          runtime_id: getRuntimeId(),
          identity_stability: resolvedIdentity.stability,
          distinct_id: resolvedIdentity.id,
          sample_rate: validationId === undefined ? rate : 1,
          $process_person_profile: false,
          $geoip_disable: true,
          ...(validationId !== undefined && {
            is_validation: true,
            validation_run_id: validationId,
          }),
        },
      });
      await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        keepalive: true,
        body,
      });
    } catch {
      return;
    }
  })();
  pending.add(request);
  void request.then(() => pending.delete(request));
}

/** Capture one anonymous, flat SDK usage event. @internal */
export function recordUsage(
  feature: string,
  action: string,
  properties: Properties = {},
  options: Options = {}
): void {
  capture(feature, action, properties, options, () =>
    identity(options.serverRoot)
  );
}

/** Wait for in-flight usage events in validation fixtures. @internal */
export async function flushUsage(): Promise<void> {
  await Promise.all([...pending]);
}
