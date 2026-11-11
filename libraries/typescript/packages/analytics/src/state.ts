/**
 * Process-wide state, kept on `globalThis` so the ESM and CJS builds (or two
 * bundled copies) share one queue per key, one in-flight guard and one set of
 * one-time warnings. Created on first use, never at module evaluation.
 */

import type { AnalyticsClient } from "./client.js";
import { uuidv7 } from "./runtime.js";
import type { AnalyticsClientInfo } from "./types.js";

/** An in-flight request a `notifications/cancelled` may cancel (see cancel.ts). */
export interface CancelWatch {
  /** Who sent the request. */
  readonly scope: string;
  /** Record the request as cancelled. */
  readonly cancel: () => void;
}

/** Client identity learned from an `initialize` exchange. */
interface SessionIdentity {
  /** `initialize` `params.clientInfo` name and version. */
  client?: AnalyticsClientInfo;
  /** Negotiated protocol version. */
  protocolVersion?: string;
}

const MAX_SESSIONS = 2_000;

/** Process-wide analytics state. */
interface AnalyticsState {
  /** Delivery clients by `endpoint \0 apiKey`. */
  clients: Map<string, AnalyticsClient>;
  /** Requests some wrapper is already recording (JSON-RPC messages, contexts). */
  inFlight: WeakSet<object>;
  /** One-time warnings already printed. */
  warned: Set<string>;
  /** `initialize` identities by transport session id (bounded, oldest evicted). */
  sessions: Map<string, SessionIdentity>;
  /** The stdio session id of this process, created on first use. */
  stdioSession?: string;
  /**
   * In-flight requests of stateless HTTP servers that a
   * `notifications/cancelled` in another HTTP request may cancel, by JSON-RPC
   * id (see cancel.ts).
   */
  cancellable?: Map<string, Set<CancelWatch>>;
  /** Set by `shutdown()`: nothing is recorded any more in this process. */
  stopped?: boolean;
}

const STATE_KEY = Symbol.for("@mcp-use/analytics.state");

/** The shared state, created on first access. */
export function globalState(): AnalyticsState {
  const holder = globalThis as Record<symbol, AnalyticsState | undefined>;
  let state = holder[STATE_KEY];
  if (state === undefined) {
    state = {
      clients: new Map(),
      inFlight: new WeakSet(),
      warned: new Set(),
      sessions: new Map(),
    };
    holder[STATE_KEY] = state;
  }
  return state;
}

/** Print a console warning once per process. */
export function warnOncePerProcess(key: string, message: string): void {
  const state = globalState();
  if (state.warned.has(key)) return;
  state.warned.add(key);
  console.warn(`[@mcp-use/analytics] ${message}`);
}

/** Remember what `initialize` told us about a transport session. */
export function rememberSession(
  sessionId: string,
  identity: SessionIdentity
): void {
  const { sessions } = globalState();
  sessions.delete(sessionId);
  sessions.set(sessionId, identity);
  if (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (oldest !== undefined) sessions.delete(oldest);
  }
}

/** What `initialize` told us about a transport session, if we saw it. */
export function recallSession(
  sessionId: string | undefined
): SessionIdentity | undefined {
  return sessionId === undefined
    ? undefined
    : globalState().sessions.get(sessionId);
}

/** One random session id per process for stdio servers. */
export function stdioSessionId(): string {
  const state = globalState();
  state.stdioSession ??= `stdio-${uuidv7()}`;
  return state.stdioSession;
}
