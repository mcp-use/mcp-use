/**
 * Dev runtime (D44). Lives in `mcp-use`, process-global under
 * `Symbol.for("mcp-use.events.dev")` and keyed by the state directory, so it
 * survives the module runner re-evaluating the entry on every hot reload.
 * The CLI feeds it plain data only, once per generation, through
 * `server.__setEventsDev?.(options)`. Never reached by a server with zero
 * registered events.
 *
 * What it owns:
 * - the generation counter and the per-process dev token (D41);
 * - the dev principal `dev|local` for non-tunnel requests on a no-OAuth
 *   server (D13 a);
 * - the trusted local inbox prefix and the loopback-through-tunnel refusal
 *   (D33);
 * - the hot-reload hooks: open `events/stream` responses of an older
 *   generation are closed gracefully (X-17), and a catalog hash change
 *   notifies opted-in `subscriptions/listen` streams (D8).
 *
 * @internal
 */

import { timingSafeEqualString } from "./token.js";

export {
  adaptEventBus,
  isMcpUseEventBus,
  type McpUseBusEvent,
  type McpUseEventBus,
} from "./event-bus.js";
export { generateDevToken, timingSafeEqualString } from "./token.js";

/** The process-global key of the dev runtime registry (D44). */
export const EVENTS_DEV_SYMBOL: unique symbol = Symbol.for(
  "mcp-use.events.dev"
) as never;

/** The dev principal (D13 a). */
export const DEV_PRINCIPAL = "dev|local";

/** Plain data the CLI passes on every generation (D44). */
export interface EventsDevOptions {
  /** Absolute state directory; the runtime key. Events data lives in `{stateDir}/events`. */
  stateDir: string;
  /** Local dev server port. */
  devPort: number;
  /** MCP base path, e.g. `"/mcp"`. */
  basePath: string;
  /** Public tunnel origin while `--tunnel` is active, e.g. `"https://x.local.mcp-use.run"`. */
  publicOrigin?: string;
  /** Random per-process dev token (D41). */
  token: string;
  /**
   * `"generation"` (default) begins a new generation and closes older
   * streams; `"tunnel"` only updates `publicOrigin` on the current one, so
   * starting or stopping a tunnel never drops open streams.
   */
  reason?: "generation" | "tunnel";
}

/** `GET …/inspector/api/dev/events` body: dev-runtime info only (D66). */
export interface EventsDevInfo {
  stateDir: string;
  generation: number;
  tokenAvailable: boolean;
  publicOrigin: string | null;
}

/** A graceful-close hook for one open `events/stream` response. */
export type DevStreamCloser = (reason: "hot_reload") => void;

/** Listener for catalog changes across generations. */
export type CatalogChangedListener = (change: {
  generation: number;
  previousHash: string;
  hash: string;
}) => void;

/** The process-global dev runtime for one state directory. */
export interface EventsDevRuntime {
  /** The runtime key. */
  readonly stateDir: string;
  /** Directory of the dev file store (`{stateDir}/events`). */
  readonly storeDir: string;
  /** Current generation, starting at 1. */
  readonly generation: number;
  readonly devPort: number;
  readonly basePath: string;
  readonly publicOrigin: string | undefined;
  /** The current dev token. */
  readonly token: string;
  /** Dev-runtime info for the Inspector (D66). */
  info(): EventsDevInfo;
  /** Constant-time check of a presented dev token. */
  verifyToken(presented: string | null | undefined): boolean;
  /** Whether the request arrived through the tunnel host. */
  isTunnelRequest(request: Request): boolean;
  /**
   * The dev principal for a request (D13 a): `"dev|local"` when no OAuth is
   * configured and the request did not come through the tunnel; otherwise
   * undefined.
   */
  principalFor(
    request: Request,
    options: { oauth: boolean }
  ): string | undefined;
  /** The trusted local inbox prefix (D33). */
  trustedCallbackPrefix(): string;
  /**
   * Validate a webhook `delivery.url` (D33). Loopback URLs are refused on
   * requests through the tunnel; the local inbox prefix is trusted on local
   * requests.
   */
  checkCallbackUrl(
    url: string,
    request: Request
  ):
    | { ok: true; trusted: boolean }
    | { ok: false; reason: "loopback_via_tunnel" };
  /**
   * Track an open `events/stream` of `generation`; the returned function
   * untracks it. Streams of older generations are closed on the next swap.
   */
  trackStream(generation: number, close: DevStreamCloser): () => void;
  /**
   * Publish the catalog hash of `generation`. Returns true, and notifies
   * listeners, when it differs from the last published hash.
   */
  publishCatalog(generation: number, hash: string): boolean;
  /** Subscribe to catalog changes; returns an unsubscribe function. */
  onCatalogChanged(listener: CatalogChangedListener): () => void;
}

interface DevRegistry {
  runtimes: Map<string, RuntimeImpl>;
  /** State directory of the most recently installed runtime. */
  active: string | undefined;
}

function registry(): DevRegistry {
  const holder = globalThis as unknown as Record<
    symbol,
    DevRegistry | undefined
  >;
  let found = holder[EVENTS_DEV_SYMBOL];
  if (found === undefined) {
    found = { runtimes: new Map(), active: undefined };
    holder[EVENTS_DEV_SYMBOL] = found;
  }
  return found;
}

function joinPath(base: string, suffix: string): string {
  const trimmed = base === "/" ? "" : base.replace(/\/+$/, "");
  return `${trimmed}/${suffix.replace(/^\/+/, "")}`;
}

function hostOf(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return undefined;
  }
}

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Whether `hostname` names the local machine (including `*.localhost` and 127/8). */
export function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    LOOPBACK_HOSTNAMES.has(h) ||
    h.endsWith(".localhost") ||
    /^127(?:\.\d{1,3}){3}$/.test(h) ||
    h === "0.0.0.0"
  );
}

class RuntimeImpl implements EventsDevRuntime {
  readonly stateDir: string;
  readonly storeDir: string;
  generation = 0;
  devPort = 0;
  basePath = "/mcp";
  publicOrigin: string | undefined;
  token = "";
  #streams = new Set<{ generation: number; close: DevStreamCloser }>();
  #catalogHash: string | undefined;
  #catalogListeners = new Set<CatalogChangedListener>();

  constructor(stateDir: string) {
    this.stateDir = stateDir;
    this.storeDir = joinPath(stateDir, "events");
  }

  /** Update the tunnel origin without starting a new generation. */
  retunnel(publicOrigin: string | undefined): void {
    this.publicOrigin = publicOrigin;
  }

  /** Begin a new generation and close every stream of an older one. */
  swap(options: EventsDevOptions): void {
    this.generation += 1;
    this.devPort = options.devPort;
    this.basePath = options.basePath;
    this.publicOrigin = options.publicOrigin;
    this.token = options.token;
    for (const entry of [...this.#streams]) {
      if (entry.generation < this.generation) {
        this.#streams.delete(entry);
        try {
          entry.close("hot_reload");
        } catch {
          // A closer that throws must not block the swap.
        }
      }
    }
  }

  info(): EventsDevInfo {
    return {
      stateDir: this.stateDir,
      generation: this.generation,
      tokenAvailable: this.token.length > 0,
      publicOrigin: this.publicOrigin ?? null,
    };
  }

  verifyToken(presented: string | null | undefined): boolean {
    if (typeof presented !== "string" || this.token.length === 0) return false;
    return timingSafeEqualString(presented, this.token);
  }

  isTunnelRequest(request: Request): boolean {
    const tunnelHost = hostOf(this.publicOrigin);
    if (tunnelHost === undefined) return false;
    const header = request.headers.get("host");
    const requestHost =
      header !== null && header.length > 0
        ? header.toLowerCase()
        : hostOf(request.url);
    if (requestHost === undefined) return false;
    const strip = (h: string): string => h.replace(/:\d+$/, "");
    return strip(requestHost) === strip(tunnelHost);
  }

  principalFor(
    request: Request,
    options: { oauth: boolean }
  ): string | undefined {
    if (options.oauth) return undefined;
    if (this.isTunnelRequest(request)) return undefined;
    return DEV_PRINCIPAL;
  }

  trustedCallbackPrefix(): string {
    return `http://localhost:${this.devPort}${joinPath(this.basePath, "inspector/api/events/hooks/")}`;
  }

  checkCallbackUrl(
    url: string,
    request: Request
  ):
    | { ok: true; trusted: boolean }
    | { ok: false; reason: "loopback_via_tunnel" } {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: true, trusted: false };
    }
    const loopback = isLoopbackHostname(parsed.hostname);
    if (loopback && this.isTunnelRequest(request)) {
      return { ok: false, reason: "loopback_via_tunnel" };
    }
    const prefix = this.trustedCallbackPrefix();
    const normalized = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    return { ok: true, trusted: normalized.startsWith(prefix) };
  }

  trackStream(generation: number, close: DevStreamCloser): () => void {
    const entry = { generation, close };
    this.#streams.add(entry);
    return () => {
      this.#streams.delete(entry);
    };
  }

  publishCatalog(generation: number, hash: string): boolean {
    if (generation < this.generation) return false;
    const previous = this.#catalogHash;
    this.#catalogHash = hash;
    if (previous === undefined || previous === hash) return false;
    for (const listener of [...this.#catalogListeners]) {
      try {
        listener({ generation, previousHash: previous, hash });
      } catch {
        // One listener must not stop the others.
      }
    }
    return true;
  }

  onCatalogChanged(listener: CatalogChangedListener): () => void {
    this.#catalogListeners.add(listener);
    return () => {
      this.#catalogListeners.delete(listener);
    };
  }
}

/** Whether `value` is plain-data {@link EventsDevOptions}. */
export function isEventsDevOptions(value: unknown): value is EventsDevOptions {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["stateDir"] === "string" &&
    v["stateDir"].length > 0 &&
    typeof v["devPort"] === "number" &&
    typeof v["basePath"] === "string" &&
    typeof v["token"] === "string" &&
    (v["publicOrigin"] === undefined || typeof v["publicOrigin"] === "string") &&
    (v["reason"] === undefined ||
      v["reason"] === "generation" ||
      v["reason"] === "tunnel")
  );
}

/**
 * Install or advance the dev runtime for `options.stateDir`: called once per
 * generation, and again with `reason: "tunnel"` when a tunnel starts or
 * stops. A generation handoff increments `generation`; a tunnel handoff on an
 * existing runtime only updates `publicOrigin`.
 *
 * @throws TypeError when `options` is not plain {@link EventsDevOptions}.
 */
export function installEventsDev(options: EventsDevOptions): EventsDevRuntime {
  if (!isEventsDevOptions(options)) {
    throw new TypeError(
      "__setEventsDev expects { stateDir, devPort, basePath, token, publicOrigin? }."
    );
  }
  const reg = registry();
  let runtime = reg.runtimes.get(options.stateDir);
  if (runtime === undefined) {
    runtime = new RuntimeImpl(options.stateDir);
    reg.runtimes.set(options.stateDir, runtime);
  }
  if (options.reason === "tunnel" && runtime.generation > 0) {
    runtime.retunnel(options.publicOrigin);
  } else {
    runtime.swap(options);
  }
  reg.active = options.stateDir;
  return runtime;
}

/** The most recently installed dev runtime, if any. */
export function activeEventsDev(): EventsDevRuntime | undefined {
  const reg = registry();
  return reg.active === undefined ? undefined : reg.runtimes.get(reg.active);
}

/** Dev-runtime info of the active runtime, or undefined outside `mcp-use dev`. */
export function eventsDevInfo(): EventsDevInfo | undefined {
  return activeEventsDev()?.info();
}

/** Remove every dev runtime (tests and process shutdown). */
export function resetEventsDev(): void {
  const reg = registry();
  reg.runtimes.clear();
  reg.active = undefined;
}
