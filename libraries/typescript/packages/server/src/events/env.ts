/**
 * The single reader of Events environment variables (PLAN.md Appendix D,
 * D60). Locked by `contracts/events/env.json`.
 *
 * Runtime knobs: code, then `MCP_USE_EVENTS_<X>`, then
 * `MCP_USE_PLATFORM_EVENTS_<X>`, then the default. `""` is unset. Secret variables are comma-separated lists.
 *
 * @internal
 */

import { EVENTS_DEFAULTS } from "./config.js";
import { EventsConfigError } from "./errors.js";

/** An environment record (`process.env`, Workers `env`, …). */
export type EnvRecord = Record<string, string | undefined>;

/** The six runtime knobs (D60). */
export const EVENTS_KNOBS = [
  "PUSH",
  "PUSH_MAX_DURATION_MS",
  "HEARTBEAT_MAX_MS",
  "POLL_INTERVAL_MS",
  "EGRESS_PROXY",
  "LOG_FORMAT",
] as const;

/** One runtime knob name. */
export type EventsKnob = (typeof EVENTS_KNOBS)[number];

/** Where a resolved value came from. */
export type KnobSource = "code" | "env" | "platform" | "default";

/** Resolved knob values with provenance. */
export interface ResolvedKnobs {
  push: { value: "auto" | "on" | "off"; source: KnobSource };
  pushMaxDurationMs: { value: number | null | undefined; source: KnobSource };
  heartbeatMaxMs: { value: number; source: KnobSource };
  pollIntervalMs: { value: number; source: KnobSource };
  egressProxy: { value: string | null; source: KnobSource };
  logFormat: { value: "text" | "json"; source: KnobSource };
}

/** Code-side values for the knobs (already converted from `EventsConfig`). */
export interface KnobCodeValues {
  push?: "auto" | "on" | "off";
  /** null = unlimited. */
  pushMaxDurationMs?: number | null;
  heartbeatMaxMs?: number;
  pollIntervalMs?: number;
  /** false disables a platform default. */
  egressProxy?: string | false;
  logFormat?: "text" | "json";
}

/** Read a variable, treating `""` (and whitespace) as unset. */
export function readVar(env: EnvRecord, name: string): string | undefined {
  const v = env[name];
  if (v === undefined) return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
}

/** Split a comma-separated secret list; empty entries dropped. */
export function readList(env: EnvRecord, name: string): string[] | undefined {
  const v = readVar(env, name);
  if (v === undefined) return undefined;
  const list = v
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  return list.length === 0 ? undefined : list;
}

function knobRaw(
  env: EnvRecord,
  knob: EventsKnob
): { raw: string; source: "env" | "platform" } | undefined {
  const user = readVar(env, `MCP_USE_EVENTS_${knob}`);
  if (user !== undefined) return { raw: user, source: "env" };
  const platform = readVar(env, `MCP_USE_PLATFORM_EVENTS_${knob}`);
  if (platform !== undefined) return { raw: platform, source: "platform" };
  return undefined;
}

function invalid(variable: string, raw: string, expected: string): never {
  throw new EventsConfigError(
    "EVENTS_CONFIG_INVALID",
    `${variable}=${JSON.stringify(raw)} is invalid: expected ${expected}.`,
    { field: variable }
  );
}

function intKnob(
  env: EnvRecord,
  knob: EventsKnob,
  min: number
): { value: number; source: "env" | "platform" } | undefined {
  const r = knobRaw(env, knob);
  if (r === undefined) return undefined;
  const n = Number(r.raw);
  if (!/^\d+$/.test(r.raw) || !Number.isSafeInteger(n) || n < min) {
    const prefix =
      r.source === "env" ? "MCP_USE_EVENTS_" : "MCP_USE_PLATFORM_EVENTS_";
    invalid(`${prefix}${knob}`, r.raw, `an integer ≥ ${min}`);
  }
  return { value: n, source: r.source };
}

/**
 * Resolve the six runtime knobs (D60).
 *
 * @param env - The environment.
 * @param code - Values from `EventsConfig`.
 */
export function resolveKnobs(
  env: EnvRecord,
  code: KnobCodeValues = {}
): ResolvedKnobs {
  let push: ResolvedKnobs["push"];
  if (code.push !== undefined) push = { value: code.push, source: "code" };
  else {
    const r = knobRaw(env, "PUSH");
    if (r === undefined) push = { value: "auto", source: "default" };
    else {
      const v = r.raw.toLowerCase();
      if (v !== "auto" && v !== "on" && v !== "off")
        invalid(
          r.source === "env"
            ? "MCP_USE_EVENTS_PUSH"
            : "MCP_USE_PLATFORM_EVENTS_PUSH",
          r.raw,
          "auto, on or off"
        );
      push = { value: v, source: r.source };
    }
  }

  let pushMaxDurationMs: ResolvedKnobs["pushMaxDurationMs"];
  if (code.pushMaxDurationMs !== undefined)
    pushMaxDurationMs = { value: code.pushMaxDurationMs, source: "code" };
  else {
    const r = intKnob(env, "PUSH_MAX_DURATION_MS", 0);
    // undefined value = "default by runtime" (§8.19).
    pushMaxDurationMs =
      r === undefined
        ? { value: undefined, source: "default" }
        : { value: r.value === 0 ? null : r.value, source: r.source };
  }

  const hb = code.heartbeatMaxMs;
  const hbEnv =
    hb === undefined ? intKnob(env, "HEARTBEAT_MAX_MS", 1) : undefined;
  const heartbeatMaxMs: ResolvedKnobs["heartbeatMaxMs"] =
    hb !== undefined
      ? { value: hb, source: "code" }
      : (hbEnv ?? { value: EVENTS_DEFAULTS.heartbeatMaxMs, source: "default" });

  const pi = code.pollIntervalMs;
  const piEnv =
    pi === undefined
      ? intKnob(env, "POLL_INTERVAL_MS", EVENTS_DEFAULTS.pollIntervalMinMs)
      : undefined;
  const pollIntervalMs: ResolvedKnobs["pollIntervalMs"] =
    pi !== undefined
      ? { value: pi, source: "code" }
      : (piEnv ?? { value: EVENTS_DEFAULTS.pollIntervalMs, source: "default" });

  let egressProxy: ResolvedKnobs["egressProxy"];
  if (code.egressProxy !== undefined)
    egressProxy = {
      value: code.egressProxy === false ? null : code.egressProxy,
      source: "code",
    };
  else {
    const r = knobRaw(env, "EGRESS_PROXY");
    egressProxy =
      r === undefined
        ? { value: null, source: "default" }
        : { value: r.raw, source: r.source };
  }

  let logFormat: ResolvedKnobs["logFormat"];
  if (code.logFormat !== undefined)
    logFormat = { value: code.logFormat, source: "code" };
  else {
    const r = knobRaw(env, "LOG_FORMAT");
    if (r === undefined) logFormat = { value: "text", source: "default" };
    else {
      const v = r.raw.toLowerCase();
      if (v !== "text" && v !== "json")
        invalid(
          r.source === "env"
            ? "MCP_USE_EVENTS_LOG_FORMAT"
            : "MCP_USE_PLATFORM_EVENTS_LOG_FORMAT",
          r.raw,
          "text or json"
        );
      logFormat = { value: v, source: r.source };
    }
  }

  return {
    push,
    pushMaxDurationMs,
    heartbeatMaxMs,
    pollIntervalMs,
    egressProxy,
    logFormat,
  };
}

/** User-binding variables. */
export interface UserBindingEnv {
  storageUrl?: string;
  storageToken?: string;
  storagePrefix?: string;
  namespace?: string;
  /** MCP_USE_EVENTS_SECRET → MCP_USE_SECRET → MCP_USE_OAUTH_SECRET. */
  keyring?: {
    keys: string[];
    source: "MCP_USE_EVENTS_SECRET" | "MCP_USE_SECRET" | "MCP_USE_OAUTH_SECRET";
  };
  mcpUrl?: string;
}

/** Platform-binding variables, read as one unit (D62). */
export interface PlatformBindingEnv {
  storageUrl?: string;
  storageToken?: string;
  storagePrefix?: string;
  secret?: string[];
  namespace?: string;
  /** True when any of the binding variables is set. */
  present: boolean;
}

/** Every Events environment input, parsed. */
export interface EventsEnvSnapshot {
  user: UserBindingEnv;
  platform: PlatformBindingEnv;
  /** User admin bearers plus platform admin bearers. */
  adminSecrets: { user?: string[]; platform?: string[] };
  /** MCP_USE_EVENTS_TICK_SECRET, then CRON_SECRET. */
  tickSecrets?: string[];
  platformName?: string;
  platformPublicUrl?: string;
  /** Parsed `MCP_USE_PLATFORM_LABELS`. */
  labels: Record<string, string>;
  buildPhase: boolean;
  devCli: boolean;
  /** Serverless markers present (D19). */
  serverless: {
    vercel: boolean;
    lambda: boolean;
    netlify: boolean;
    deno: boolean;
  };
  nodeEnvTest: boolean;
}

/** Parse `k=v,k=v` labels. */
export function parseLabels(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw === undefined) return out;
  for (const part of raw.split(",")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k !== "" && v !== "") out[k] = v;
  }
  return out;
}

/**
 * Read every Events environment input.
 *
 * @param env - The environment.
 */
export function readEventsEnv(env: EnvRecord): EventsEnvSnapshot {
  const keyringSources = [
    "MCP_USE_EVENTS_SECRET",
    "MCP_USE_SECRET",
    "MCP_USE_OAUTH_SECRET",
  ] as const;
  let keyring: UserBindingEnv["keyring"];
  for (const source of keyringSources) {
    const keys = readList(env, source);
    if (keys !== undefined) {
      keyring = { keys, source };
      break;
    }
  }
  const user: UserBindingEnv = {};
  const su = readVar(env, "MCP_USE_STORAGE_URL");
  if (su !== undefined) user.storageUrl = su;
  const st = readVar(env, "MCP_USE_STORAGE_TOKEN");
  if (st !== undefined) user.storageToken = st;
  const sp = readVar(env, "MCP_USE_STORAGE_PREFIX");
  if (sp !== undefined) user.storagePrefix = sp;
  const ns = readVar(env, "MCP_USE_EVENTS_NAMESPACE");
  if (ns !== undefined) user.namespace = ns;
  if (keyring !== undefined) user.keyring = keyring;
  const mu = readVar(env, "MCP_URL");
  if (mu !== undefined) user.mcpUrl = mu;

  const platform: PlatformBindingEnv = { present: false };
  const pu = readVar(env, "MCP_USE_PLATFORM_STORAGE_URL");
  const pt = readVar(env, "MCP_USE_PLATFORM_STORAGE_TOKEN");
  const pp = readVar(env, "MCP_USE_PLATFORM_STORAGE_PREFIX");
  const ps = readList(env, "MCP_USE_PLATFORM_SECRET");
  const pn = readVar(env, "MCP_USE_PLATFORM_NAMESPACE");
  if (pu !== undefined) platform.storageUrl = pu;
  if (pt !== undefined) platform.storageToken = pt;
  if (pp !== undefined) platform.storagePrefix = pp;
  if (ps !== undefined) platform.secret = ps;
  if (pn !== undefined) platform.namespace = pn;
  platform.present = [pu, pt, pp, ps, pn].some((v) => v !== undefined);

  const adminSecrets: EventsEnvSnapshot["adminSecrets"] = {};
  const ua = readList(env, "MCP_USE_EVENTS_ADMIN_SECRET");
  if (ua !== undefined) adminSecrets.user = ua;
  const pa = readList(env, "MCP_USE_PLATFORM_ADMIN_SECRET");
  if (pa !== undefined) adminSecrets.platform = pa;

  const snapshot: EventsEnvSnapshot = {
    user,
    platform,
    adminSecrets,
    labels: parseLabels(readVar(env, "MCP_USE_PLATFORM_LABELS")),
    buildPhase: readVar(env, "MCP_USE_PHASE") === "build",
    devCli: readVar(env, "MCP_USE_DEV_CLI") !== undefined,
    serverless: {
      vercel: readVar(env, "VERCEL") !== undefined,
      lambda: readVar(env, "AWS_LAMBDA_FUNCTION_NAME") !== undefined,
      netlify: readVar(env, "NETLIFY") !== undefined,
      deno: readVar(env, "DENO_DEPLOYMENT_ID") !== undefined,
    },
    nodeEnvTest: readVar(env, "NODE_ENV") === "test",
  };
  const tick =
    readList(env, "MCP_USE_EVENTS_TICK_SECRET") ?? readList(env, "CRON_SECRET");
  if (tick !== undefined) snapshot.tickSecrets = tick;
  const name = readVar(env, "MCP_USE_PLATFORM_NAME");
  if (name !== undefined) snapshot.platformName = name;
  const pub = readVar(env, "MCP_USE_PLATFORM_PUBLIC_URL");
  if (pub !== undefined) snapshot.platformPublicUrl = pub;
  return snapshot;
}

/**
 * Required platform-binding variables that are missing, when the binding is
 * present (D62). Empty when complete or absent.
 *
 * @param platform - The parsed platform binding.
 * @param urlNeedsToken - Whether the URL form requires a token.
 */
export function missingPlatformBinding(
  platform: PlatformBindingEnv,
  urlNeedsToken = true
): string[] {
  if (!platform.present) return [];
  const missing: string[] = [];
  if (platform.storageUrl === undefined)
    missing.push("MCP_USE_PLATFORM_STORAGE_URL");
  if (urlNeedsToken && platform.storageToken === undefined)
    missing.push("MCP_USE_PLATFORM_STORAGE_TOKEN");
  if (platform.namespace === undefined)
    missing.push("MCP_USE_PLATFORM_NAMESPACE");
  if (platform.secret === undefined) missing.push("MCP_USE_PLATFORM_SECRET");
  return missing;
}

/** Every variable this module reads (exported for the env contract snapshot). */
export const EVENTS_ENV_VARIABLES: readonly string[] = [
  "MCP_USE_STORAGE_URL",
  "MCP_USE_STORAGE_TOKEN",
  "MCP_USE_STORAGE_PREFIX",
  "MCP_USE_SECRET",
  "MCP_USE_EVENTS_SECRET",
  "MCP_USE_OAUTH_SECRET",
  "MCP_USE_EVENTS_NAMESPACE",
  "MCP_USE_EVENTS_ADMIN_SECRET",
  "MCP_USE_EVENTS_TICK_SECRET",
  "CRON_SECRET",
  ...EVENTS_KNOBS.map((k) => `MCP_USE_EVENTS_${k}`),
  ...EVENTS_KNOBS.map((k) => `MCP_USE_PLATFORM_EVENTS_${k}`),
  "MCP_URL",
  "MCP_USE_PLATFORM_NAME",
  "MCP_USE_PLATFORM_STORAGE_URL",
  "MCP_USE_PLATFORM_STORAGE_TOKEN",
  "MCP_USE_PLATFORM_STORAGE_PREFIX",
  "MCP_USE_PLATFORM_SECRET",
  "MCP_USE_PLATFORM_NAMESPACE",
  "MCP_USE_PLATFORM_ADMIN_SECRET",
  "MCP_USE_PLATFORM_PUBLIC_URL",
  "MCP_USE_PLATFORM_LABELS",
  "MCP_USE_PHASE",
  "MCP_USE_DEV_CLI",
  "VERCEL",
  "AWS_LAMBDA_FUNCTION_NAME",
  "NETLIFY",
  "DENO_DEPLOYMENT_ID",
  "NODE_ENV",
];
