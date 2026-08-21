import type { OAuthClientProvider } from "@modelcontextprotocol/client";
import type { BrowserMCPClient } from "../core/browser.js";
import type { MCPConnection } from "../core/session.js";

/**
 * The OAuth provider shape used by useMcp.  This lives here because a provider
 * belongs to one connection lifecycle: replacing the provider (for example
 * after an OAuth callback) must not change an already-running lifecycle.
 */
export type UseMcpAuthProvider = OAuthClientProvider & {
  tokens?: () => Promise<
    | {
        access_token?: string;
        token_type?: string;
        refresh_token?: string;
        scope?: string;
        [key: string]: unknown;
      }
    | undefined
  >;
  clearStorage?: () => number;
  getLastAttemptedAuthUrl?: () => string | null | undefined;
  getTokenEndpoint?: () => Promise<string | null>;
  getResource?: () => Promise<string | null>;
  getClientCredentials?: () => Promise<{
    client_id: string;
    client_secret?: string;
  } | null>;
  getProxyFetch?: (baseFetch?: typeof fetch) => typeof fetch | undefined;
  serverUrl?: string;
  getKey?: (keySuffix: string) => string;
  serverUrlHash?: string;
};

/** A lifecycle's transport state, including states in which no session exists. */
export type ConnectionLifecyclePhase =
  | "connecting"
  | "waiting_for_auth"
  | "authenticating"
  | "ready"
  | "failed"
  | "retiring"
  | "retired";

/** Why this lifecycle was started. Primarily useful for coalescing and logs. */
export type ConnectionLifecycleTrigger =
  | "configuration"
  | "manual-retry"
  | "auto-retry"
  | "oauth-success"
  | "health-check"
  | "proxy-fallback";

/**
 * A complete ownership record for one `useMcp` connection attempt.
 *
 * A lifecycle intentionally owns a fresh client.  It is never safe for an old
 * lifecycle to close or mutate a client owned by a newer lifecycle.
 */
export interface ConnectionLifecycle<TSnapshot = unknown> {
  readonly id: number;
  readonly trigger: ConnectionLifecycleTrigger;
  readonly serverName: string;
  readonly client: BrowserMCPClient;
  readonly authProvider: UseMcpAuthProvider;
  readonly snapshot: TSnapshot;

  connection: MCPConnection | null;
  phase: ConnectionLifecyclePhase;
  started: boolean;
  cancelled: boolean;
  healthCleanup: (() => void) | null;
  /** Serializes all client closes requested for this lifecycle. */
  teardownPromise: Promise<void> | null;
}

export type ConnectionLifecycleRef<TSnapshot = unknown> = {
  current: ConnectionLifecycle<TSnapshot> | null;
};

export function createConnectionLifecycle<TSnapshot>(params: {
  id: number;
  trigger: ConnectionLifecycleTrigger;
  serverName: string;
  client: BrowserMCPClient;
  authProvider: UseMcpAuthProvider;
  snapshot: TSnapshot;
}): ConnectionLifecycle<TSnapshot> {
  return {
    ...params,
    connection: null,
    phase: "connecting",
    started: false,
    cancelled: false,
    healthCleanup: null,
    teardownPromise: null,
  };
}

/** Whether this lifecycle still exclusively owns hook state. */
export function isCurrentLifecycle<TSnapshot>(
  lifecycleRef: ConnectionLifecycleRef<TSnapshot>,
  lifecycle: ConnectionLifecycle<TSnapshot>
): boolean {
  return lifecycleRef.current === lifecycle && !lifecycle.cancelled;
}

/**
 * Execute a state commit only while this lifecycle owns the hook.  Returning a
 * boolean lets callers distinguish a skipped stale commit from a successful
 * one without reading mutable refs again.
 */
export function commitLifecycle<TSnapshot>(
  lifecycleRef: ConnectionLifecycleRef<TSnapshot>,
  lifecycle: ConnectionLifecycle<TSnapshot>,
  commit: () => void
): boolean {
  if (!isCurrentLifecycle(lifecycleRef, lifecycle)) {
    return false;
  }

  commit();
  return true;
}

/** Queue a close after any earlier close, preserving teardown ordering. */
function queueClientClose<TSnapshot>(
  lifecycle: ConnectionLifecycle<TSnapshot>
): Promise<void> {
  const previous = lifecycle.teardownPromise ?? Promise.resolve();
  const closePromise = previous
    // A failed close must not prevent a later-arriving connection from being
    // closed. The newly queued close remains observable to its caller.
    .catch(() => undefined)
    .then(async () => {
      await lifecycle.client.closeSession(lifecycle.serverName);
    });

  lifecycle.teardownPromise = closePromise;
  void closePromise.then(
    () => {
      if (lifecycle.teardownPromise === closePromise && lifecycle.cancelled) {
        lifecycle.phase = "retired";
      }
    },
    () => {
      if (lifecycle.teardownPromise === closePromise && lifecycle.cancelled) {
        lifecycle.phase = "retired";
      }
    }
  );

  return closePromise;
}

/**
 * Record the connection once `client.connect()` resolves.
 *
 * If cancellation happened while connect was pending, a second close is
 * queued. This is essential: closing a client before it has a session does not
 * close the session that `connect()` adds later.
 */
export function attachLifecycleConnection<TSnapshot>(
  lifecycle: ConnectionLifecycle<TSnapshot>,
  connection: MCPConnection
): Promise<void> | null {
  lifecycle.connection = connection;

  return lifecycle.cancelled ? queueClientClose(lifecycle) : null;
}

/**
 * Close once more when a pending connection attempt settles by rejecting after
 * retirement. The client may have created a session internally before the
 * rejected promise became observable to the hook.
 */
export function closeRetiredLifecycleAfterConnectFailure<TSnapshot>(
  lifecycle: ConnectionLifecycle<TSnapshot>
): Promise<void> | null {
  return lifecycle.cancelled ? queueClientClose(lifecycle) : null;
}

/**
 * Synchronously retire a lifecycle, then asynchronously release its resources.
 * The operation is idempotent and safe before a pending `connect()` resolves.
 */
export function retireLifecycle<TSnapshot>(
  lifecycle: ConnectionLifecycle<TSnapshot>
): Promise<void> {
  if (lifecycle.cancelled) {
    return lifecycle.teardownPromise ?? queueClientClose(lifecycle);
  }

  lifecycle.cancelled = true;
  lifecycle.phase = "retiring";

  try {
    lifecycle.healthCleanup?.();
  } finally {
    lifecycle.healthCleanup = null;
  }

  // React Strict Mode may retire its preflight Effect before the queued
  // lifecycle runner starts. No server/session exists in that case, so avoid a
  // noisy closeSession() call against an untouched client.
  if (!lifecycle.started) {
    lifecycle.phase = "retired";
    return Promise.resolve();
  }

  return queueClientClose(lifecycle);
}
