/**
 * Requests the client cancelled. A cancelled request is recorded without an
 * outcome as soon as the cancellation is seen, like a gateway request whose
 * stream closed before the response, and never with what its handler returns
 * afterwards: the SDKs do not send that reply.
 *
 * - With a session (and on stdio), `notifications/cancelled` reaches the
 *   server instance running the handler and aborts the handler's signal (SDK
 *   v1 `extra.signal`, SDK v2 `ctx.mcpReq.signal`). A 2026-era client aborts
 *   its HTTP request instead, which aborts the same signal and the request's
 *   own `signal`.
 * - A stateless HTTP server serves the notification in an HTTP request of its
 *   own, often on a fresh server instance, so it never reaches the handler's
 *   signal. It is matched here to the in-flight request with the same
 *   JSON-RPC id from the same requester (same credentials, `User-Agent` and
 *   forwarding headers); when that is ambiguous nothing is cancelled.
 */

import type { HeaderReader } from "./record.js";
import { globalState, type CancelWatch } from "./state.js";

/** Headers that tell requesters of a stateless server apart. */
const REQUESTER_HEADERS = [
  "authorization",
  "user-agent",
  "mcp-protocol-version",
  "x-forwarded-for",
  "forwarded",
  "x-real-ip",
  "cf-connecting-ip",
  "true-client-ip",
  "fly-client-ip",
] as const;

/** Upper bound on watched ids, so handlers that never settle cannot grow it. */
const MAX_WATCHED_IDS = 10_000;

/** An `AbortSignal`, or anything shaped like one. */
interface SignalLike {
  readonly aborted: boolean;
  addEventListener(type: "abort", listener: () => void): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

const NOOP = (): void => undefined;

function isSignal(value: unknown): value is SignalLike {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { aborted?: unknown }).aborted === "boolean" &&
    typeof (value as { addEventListener?: unknown }).addEventListener ===
      "function" &&
    typeof (value as { removeEventListener?: unknown }).removeEventListener ===
      "function"
  );
}

/**
 * Call `listener` once when any of `signals` aborts (at once when one already
 * did). Returns a function that stops listening.
 */
export function onAbort(
  signals: readonly unknown[],
  listener: () => void
): () => void {
  const watched: SignalLike[] = [];
  for (const signal of signals) {
    if (!isSignal(signal) || watched.includes(signal)) continue;
    if (signal.aborted) {
      listener();
      return NOOP;
    }
    watched.push(signal);
  }
  if (watched.length === 0) return NOOP;
  let done = false;
  const stop = (): void => {
    if (done) return;
    done = true;
    for (const signal of watched) {
      try {
        signal.removeEventListener("abort", fire);
      } catch {
        // Best effort.
      }
    }
  };
  const fire = (): void => {
    stop();
    listener();
  };
  for (const signal of watched) signal.addEventListener("abort", fire);
  return stop;
}

/** Who sent a request to a stateless server, as far as its headers tell. */
export function requesterScope(header: HeaderReader): string {
  return REQUESTER_HEADERS.map((name) => header(name) ?? "").join("\n");
}

function idKey(id: string | number): string {
  return `${typeof id}:${id}`;
}

/**
 * Let a `notifications/cancelled` for `id` from the same requester cancel a
 * request in flight on a stateless server. Returns a function that stops
 * watching (call it once the request settled).
 */
export function watchCancellation(
  id: string | number,
  scope: string,
  cancel: () => void
): () => void {
  const state = globalState();
  const watches = (state.cancellable ??= new Map<string, Set<CancelWatch>>());
  const key = idKey(id);
  let set = watches.get(key);
  if (set === undefined) {
    if (watches.size >= MAX_WATCHED_IDS) return NOOP;
    set = new Set<CancelWatch>();
    watches.set(key, set);
  }
  const watch: CancelWatch = { scope, cancel };
  set.add(watch);
  return () => {
    const current = watches.get(key);
    if (current === undefined || !current.delete(watch)) return;
    if (current.size === 0) watches.delete(key);
  };
}

/**
 * Cancel the in-flight request a `notifications/cancelled` names, when
 * exactly one request with that id from the same requester is watched.
 */
export function cancelRequest(id: string | number, scope: string): void {
  const watches = globalState().cancellable;
  const key = idKey(id);
  const set = watches?.get(key);
  if (watches === undefined || set === undefined) return;
  let match: CancelWatch | undefined;
  for (const watch of set) {
    if (watch.scope !== scope) continue;
    if (match !== undefined) return;
    match = watch;
  }
  if (match === undefined) return;
  set.delete(match);
  if (set.size === 0) watches.delete(key);
  match.cancel();
}

/** The request id of a `notifications/cancelled` message, if it is one. */
export function cancelledRequestId(
  message: unknown
): string | number | undefined {
  if (typeof message !== "object" || message === null) return undefined;
  const m = message as Record<string, unknown>;
  if (m["method"] !== "notifications/cancelled" || m["id"] !== undefined)
    return undefined;
  const params = m["params"];
  if (typeof params !== "object" || params === null) return undefined;
  const id = (params as Record<string, unknown>)["requestId"];
  return typeof id === "string" || typeof id === "number" ? id : undefined;
}
