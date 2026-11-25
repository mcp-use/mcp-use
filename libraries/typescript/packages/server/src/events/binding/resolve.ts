/**
 * The D16 store binding chain (PLAN.md §8.5): build inert → `events.storage`
 * → `ServerConfig.storage` → `MCP_USE_STORAGE_URL` → dev runtime → platform
 * binding → memory (test, loopback, `unsafeAllowEphemeral`) → unconfigured.
 *
 * @internal
 */

import { isMcpUseStorage, type McpUseStorage } from "../../storage/types.js";
import {
  openStorageUrl,
  parseStorageUrl,
  type StorageRuntime,
  type StorageUrlTarget,
} from "../../storage/url.js";
import { readEventsEnv, type EnvRecord } from "../env.js";
import { EventsConfigError } from "../errors.js";
import { planDevBinding, type DevRuntimeInfo } from "./dev.js";
import {
  generateSecretSuggestion,
  resolveUserKeyring,
} from "./keyring-source.js";
import { ns16, resolveUserNamespace } from "./namespace.js";
import { planPlatformBinding } from "./platform.js";

/** Which step of the chain produced the binding. */
export type BindingKind = "user" | "dev" | "platform" | "memory";

/** A usable binding. */
export interface ActiveBinding {
  kind: BindingKind;
  storage: McpUseStorage;
  namespace: string;
  nsHash: string;
  keyring: string[];
  unsealed: boolean;
  /** Platform name for `binding=platform(<name>)`. */
  platformName?: string;
  /** Startup warnings to log once. */
  warnings: string[];
}

/** Result of {@link resolveStoreBinding}. */
export type ResolvedBinding =
  | ({ state: "active" } & ActiveBinding)
  | { state: "inert" }
  | { state: "unconfigured"; reason: string };

/** Inputs of {@link resolveStoreBinding}. */
export interface ResolveBindingInput {
  env: EnvRecord;
  /** `events.storage`. */
  eventsStorage?: McpUseStorage;
  /** `ServerConfig.storage`. */
  serverStorage?: McpUseStorage;
  /** `events.namespace`. */
  namespace?: string;
  /** `events.secret`. */
  secret?: string | readonly string[];
  /** `events.unsafeAllowEphemeral`. */
  unsafeAllowEphemeral?: boolean;
  /** CLI dev runtime, when active. */
  devRuntime?: DevRuntimeInfo;
  /** True for a loopback `listen()` outside production. */
  loopbackListen?: boolean;
  /** OAuth protected resource URL. */
  oauthResource?: string;
  basePath?: string;
  serverName: string;
  runtime?: StorageRuntime;
  /** Opens a parsed storage URL; default `openStorageUrl`. */
  open?: (target: StorageUrlTarget) => Promise<unknown>;
}

function isProduction(env: EnvRecord): boolean {
  return env["NODE_ENV"] === "production";
}

async function openChecked(
  open: (t: StorageUrlTarget) => Promise<unknown>,
  target: StorageUrlTarget
): Promise<McpUseStorage> {
  const s = await open(target);
  if (!isMcpUseStorage(s))
    throw new EventsConfigError(
      "STORAGE_UNSUPPORTED",
      `events: the ${target.kind} store does not implement McpUseStorage.`,
      { kind: target.kind }
    );
  return s;
}

/**
 * Resolve the store binding. Throws on misconfiguration (D17): an
 * incomplete platform binding or a durable production store without a key.
 *
 * @param input - Config, environment and runtime facts.
 */
export async function resolveStoreBinding(
  input: ResolveBindingInput
): Promise<ResolvedBinding> {
  const env = input.env;
  const snap = readEventsEnv(env);
  if (snap.buildPhase) return { state: "inert" };
  const open = input.open ?? ((t) => openStorageUrl(t));

  // Steps 2–4: user binding.
  let userStorage = input.eventsStorage ?? input.serverStorage;
  if (userStorage === undefined) {
    const target = parseStorageUrl(env, { runtime: input.runtime ?? "node" });
    if (target !== undefined) userStorage = await openChecked(open, target);
  }
  if (userStorage !== undefined) {
    const warnings: string[] = [];
    const ns = resolveUserNamespace({
      config: input.namespace,
      env: snap.user.namespace,
      devWorkspace: input.devRuntime?.workspace,
      oauthResource: input.oauthResource,
      mcpUrl: snap.user.mcpUrl ?? snap.platformPublicUrl,
      basePath: input.basePath,
      serverName: input.serverName,
    });
    if (ns.warning !== undefined) warnings.push(ns.warning);
    const kr = resolveUserKeyring(input.secret, snap);
    const unsealed = input.devRuntime !== undefined && kr.keys.length === 0;
    if (kr.keys.length === 0 && !unsealed) {
      if (userStorage.durable && isProduction(env))
        throw new EventsConfigError(
          "EVENTS_SECRET_REQUIRED",
          `events: a durable store in production needs a keyring. Set MCP_USE_EVENTS_SECRET, for example MCP_USE_EVENTS_SECRET=${generateSecretSuggestion()}`
        );
    }
    return {
      state: "active",
      kind: "user",
      storage: userStorage,
      namespace: ns.namespace,
      nsHash: await ns16(ns.namespace),
      keyring: kr.keys,
      unsealed: unsealed || kr.keys.length === 0,
      warnings,
    };
  }

  // Step 5: dev runtime (beats the platform binding).
  if (input.devRuntime !== undefined) {
    const plan = planDevBinding(input.devRuntime);
    const storage = await openChecked(open, plan.target);
    return {
      state: "active",
      kind: "dev",
      storage,
      namespace: plan.namespace,
      nsHash: await ns16(plan.namespace),
      keyring: [],
      unsealed: true,
      warnings: [],
    };
  }

  // Step 6: platform binding.
  const ignoredUser =
    input.namespace !== undefined ||
    input.secret !== undefined ||
    snap.user.namespace !== undefined ||
    snap.user.keyring !== undefined;
  const platform = planPlatformBinding(snap, ignoredUser);
  if (platform !== undefined) {
    const storage = await openChecked(open, platform.target);
    const out: ResolvedBinding = {
      state: "active",
      kind: "platform",
      storage,
      namespace: platform.namespace,
      nsHash: await ns16(platform.namespace),
      keyring: platform.keyring,
      unsealed: false,
      warnings: platform.warning === undefined ? [] : [platform.warning],
    };
    if (platform.name !== undefined) out.platformName = platform.name;
    return out;
  }

  // Step 7: memory.
  if (
    snap.nodeEnvTest ||
    input.unsafeAllowEphemeral === true ||
    (input.loopbackListen === true && !isProduction(env))
  ) {
    const storage = await openChecked(open, { kind: "memory", prefix: "" });
    const ns = resolveUserNamespace({
      config: input.namespace,
      env: snap.user.namespace,
      serverName: input.serverName,
    });
    const kr = resolveUserKeyring(input.secret, snap);
    return {
      state: "active",
      kind: "memory",
      storage,
      namespace: ns.namespace,
      nsHash: await ns16(ns.namespace),
      keyring: kr.keys,
      unsealed: kr.keys.length === 0,
      warnings: [],
    };
  }

  return {
    state: "unconfigured",
    reason:
      "no store: set events.storage, ServerConfig.storage or MCP_USE_STORAGE_URL",
  };
}
