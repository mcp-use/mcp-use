import type {
  OAuthClientInformation,
  OAuthClientInformationContext,
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthDiscoveryState,
  OAuthTokens,
} from "@modelcontextprotocol/client";
import { createServer as createNetServer } from "node:net";
import { createServer as createHttpServer, type Server } from "node:http";
import { FileKVStore } from "./storage-file.js";
import type { KVStore } from "./storage.js";
import {
  OAuthSessionStore,
  type OAuthSessionStoreOptions,
} from "./session-store.js";

const DEFAULT_PORT = 33418;
const PORT_RANGE = 10;
const DEFAULT_AUTH_TIMEOUT_MS = 5 * 60_000;

/** Configures OAuth authorization for Node.js and CLI clients. */
export interface NodeOAuthOptions extends OAuthSessionStoreOptions {
  /** Preferred loopback port. Default 33418. Walks up by `portRange` on EADDRINUSE. */
  preferredPort?: number;
  /** Number of consecutive loopback ports to try. Defaults to `10`. */
  portRange?: number;
  /** Override the on-disk store directory (mostly for tests). */
  baseDir?: string;
  /** Override KV store entirely (mostly for tests). */
  kvStore?: KVStore;
  /** Loopback wait timeout. Default 5 minutes. */
  authTimeoutMs?: number;
  /** Suppress the default `open(url)` browser launch (test hook). */
  openBrowser?: (url: string) => Promise<void> | void;
}

/**
 * Error reported by the local OAuth callback flow.
 *
 * The {@link OAuthFlowError.code} value is a stable OAuth or local-flow error
 * code such as `"timeout"` or `"cancelled"`.
 */
export class OAuthFlowError extends Error {
  /** OAuth or local-flow error code. */
  readonly code: string;
  /** Optional human-readable error description. */
  readonly description?: string;

  /**
   * Creates an OAuth flow error.
   *
   * @param code - OAuth or local-flow error code.
   * @param description - Optional human-readable description.
   */
  constructor(code: string, description?: string) {
    super(description ? `${code}: ${description}` : code);
    this.code = code;
    this.description = description;
    this.name = "OAuthFlowError";
  }
}

/** Authorization response captured by the Node loopback callback. */
export interface NodeOAuthAuthorizationResponse {
  /** Authorization code returned by the authorization server. */
  code: string;
  /** RFC 9207 authorization-server issuer, when present in the callback. */
  iss?: string;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: Error) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = createNetServer();
    tester.once("error", () => resolve(false));
    tester.once("listening", () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, "127.0.0.1");
  });
}

async function reservePort(
  preferred: number,
  range: number
): Promise<number | null> {
  for (let p = preferred; p < preferred + range; p++) {
    if (await isPortFree(p)) return p;
  }
  return null;
}

const SUCCESS_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Authentication complete</title>
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;padding:0 24px;color:#222}
h1{font-size:20px;margin:0 0 12px}p{line-height:1.5}</style></head>
<body><h1>Authentication complete</h1>
<p>You can close this tab and return to your terminal.</p></body></html>`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const FAILURE_HTML = (err: string, desc?: string) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Authentication failed</title>
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;padding:0 24px;color:#222}
h1{font-size:20px;margin:0 0 12px;color:#b00020}p{line-height:1.5}code{background:#f3f3f3;padding:2px 6px;border-radius:3px}</style></head>
<body><h1>Authentication failed</h1>
<p><code>${escapeHtml(err)}</code>${desc ? `: ${escapeHtml(desc)}` : ""}</p>
<p>You can close this tab and return to your terminal.</p></body></html>`;

/**
 * Node/CLI OAuth client provider for MCP. Owns a localhost loopback callback
 * server, opens the user's browser, and resolves the authorization code via
 * `getAuthorizationCode()` — designed for the orchestrator pattern in
 * `useMcp.ts:1121-1145`.
 *
 * Use the static `create()` factory; the constructor is internal because
 * port reservation is async.
 */
export class NodeOAuthClientProvider implements OAuthClientProvider {
  /** Protected MCP server URL associated with this provider. */
  readonly serverUrl: string;
  /** Reserved localhost callback port. */
  readonly port: number;

  private session: OAuthSessionStore;
  private kv: KVStore;
  private authTimeoutMs: number;
  private openBrowserOverride?: (url: string) => Promise<void> | void;
  /** Whether the selected callback port still needs to be written to storage. */
  private shouldPersistSelectedPort: boolean;

  private server: Server | null = null;
  /** Provider authorization URL, exposed only through the local redirect route. */
  private authorizationUrl: string | null = null;
  /** Currently in-flight deferred — used to prevent overlapping flows. */
  private pending: Deferred<NodeOAuthAuthorizationResponse> | null = null;
  /** Latest deferred (settled or in-flight) for the loopback response. */
  private lastFlow: Deferred<NodeOAuthAuthorizationResponse> | null = null;
  private pendingTimer: NodeJS.Timeout | null = null;
  /**
   * Synchronously set before the first `await` in `redirectToAuthorization()`
   * to reserve the authorization slot. Prevents a second concurrent call from
   * passing the `pending` check while the first is still initializing.
   */
  private authorizing = false;
  /**
   * Set by {@link dispose} while initialization is still awaiting storage or
   * `startLoopback()`. The in-flight `redirectToAuthorization()` must abort
   * instead of arming `pending` and leaking the loopback listener.
   */
  private initCancelled = false;

  private constructor(
    serverUrl: string,
    port: number,
    session: OAuthSessionStore,
    kv: KVStore,
    options: NodeOAuthOptions,
    shouldPersistSelectedPort: boolean
  ) {
    this.serverUrl = serverUrl;
    this.port = port;
    this.session = session;
    this.kv = kv;
    this.authTimeoutMs = options.authTimeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS;
    this.openBrowserOverride = options.openBrowser;
    this.shouldPersistSelectedPort = shouldPersistSelectedPort;
  }

  /**
   * Creates a Node OAuth provider and reserves a localhost callback port.
   *
   * @param serverUrl - Protected MCP server URL.
   * @param options - OAuth metadata, storage, loopback, and browser options.
   * @returns A provider ready to participate in the SDK OAuth flow.
   */
  static async create(
    serverUrl: string,
    options: NodeOAuthOptions = {}
  ): Promise<NodeOAuthClientProvider> {
    const serverUrlHash = OAuthSessionStore.hashString(serverUrl);
    const kv =
      options.kvStore ?? new FileKVStore(serverUrlHash, options.baseDir);

    const persistedPortRaw = await kv.get("port");
    const persistedPort = persistedPortRaw
      ? Number.parseInt(persistedPortRaw, 10)
      : null;
    const preferred =
      persistedPort && Number.isFinite(persistedPort)
        ? persistedPort
        : (options.preferredPort ?? DEFAULT_PORT);
    const range = options.portRange ?? PORT_RANGE;

    let port = await reservePort(preferred, range);
    if (port === null) {
      // Fall back to ephemeral. Will trigger DCR re-register on next call
      // because the redirect_uri changes — that path already works.
      port = await new Promise<number>((resolve, reject) => {
        const probe = createNetServer();
        probe.once("error", reject);
        probe.once("listening", () => {
          const addr = probe.address();
          const p = typeof addr === "object" && addr ? addr.port : 0;
          probe.close(() => resolve(p));
        });
        probe.listen(0, "127.0.0.1");
      });
    }

    const callbackUrl = `http://127.0.0.1:${port}/callback`;
    const session = new OAuthSessionStore(
      serverUrl,
      { ...options, callbackUrl },
      kv
    );

    return new NodeOAuthClientProvider(
      serverUrl,
      port,
      session,
      kv,
      options,
      port !== persistedPort
    );
  }

  // --- Identity passthroughs (parallel to BrowserOAuthClientProvider) ---

  /** Prefix used for persisted OAuth session keys. */
  get storageKeyPrefix(): string {
    return this.session.storageKeyPrefix;
  }

  /** Stable hash of the protected server URL used to namespace storage. */
  get serverUrlHash(): string {
    return this.session.serverUrlHash;
  }

  // --- SDK Interface (delegated to OAuthSessionStore) ---

  /** Loopback redirect URL registered for this provider. */
  get redirectUrl(): string {
    return this.session.redirectUrl;
  }

  /** OAuth client metadata presented during registration. */
  get clientMetadata(): OAuthClientMetadata {
    return this.session.clientMetadata;
  }

  /** OAuth Client ID Metadata Document URL, when configured. */
  get clientMetadataUrl(): string | undefined {
    return this.session.clientMetadataUrl;
  }

  /**
   * Loads saved OAuth tokens.
   *
   * @param ctx - Optional client registration context.
   * @returns Saved tokens, or `undefined` when none exist.
   */
  tokens(
    ctx?: OAuthClientInformationContext
  ): Promise<OAuthTokens | undefined> {
    return this.session.tokens(ctx);
  }

  /**
   * Persists OAuth tokens.
   *
   * @param tokens - Tokens to save.
   * @param ctx - Optional client registration context.
   */
  saveTokens(
    tokens: OAuthTokens,
    ctx?: OAuthClientInformationContext
  ): Promise<void> {
    return this.session.saveTokens(tokens, ctx);
  }

  /**
   * Loads saved OAuth client registration information.
   *
   * @param ctx - Optional registration context.
   * @returns Saved registration information, or `undefined`.
   */
  clientInformation(
    ctx?: OAuthClientInformationContext
  ): Promise<OAuthClientInformation | undefined> {
    return this.session.clientInformation(ctx);
  }

  /**
   * Persists OAuth client registration information.
   *
   * @param info - Client information to save.
   * @param ctx - Optional registration context.
   */
  saveClientInformation(
    info: OAuthClientInformation,
    ctx?: OAuthClientInformationContext
  ): Promise<void> {
    return this.session.saveClientInformation(info, ctx);
  }

  /**
   * Loads the saved PKCE code verifier.
   *
   * @returns The saved verifier.
   */
  codeVerifier(): Promise<string> {
    return this.session.codeVerifier();
  }

  /**
   * Persists a PKCE code verifier.
   *
   * @param codeVerifier - Verifier to save.
   */
  saveCodeVerifier(codeVerifier: string): Promise<void> {
    return this.session.saveCodeVerifier(codeVerifier);
  }

  /**
   * Invalidates selected persisted OAuth credentials.
   *
   * @param scope - Credential group to remove.
   */
  invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery"
  ): Promise<void> {
    return this.session.invalidateCredentials(scope);
  }

  /**
   * Persists OAuth discovery state.
   *
   * @param state - Discovery state to save.
   */
  saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    return this.session.saveDiscoveryState(state);
  }

  /**
   * Returns previously saved OAuth discovery state.
   *
   * @returns Saved discovery state, or `undefined`.
   */
  discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    return this.session.discoveryState();
  }

  /**
   * Bind the loopback server, set up the pending-code deferred, and ask the
   * platform to open the user's browser. Does NOT await the code; the
   * orchestrator awaits via `getAuthorizationCode()`.
   *
   * @param authorizationUrl - Authorization URL generated by the SDK.
   * @returns A promise that resolves once the loopback listener is ready and
   * the browser-open attempt completes.
   */
  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    if (this.pending || this.authorizing) {
      throw new Error(
        "NodeOAuthClientProvider: an authorization is already in progress"
      );
    }

    // Reserve the slot synchronously before any await so that concurrent
    // callers observe `authorizing === true` and are rejected immediately.
    // Create `lastFlow` now so `completeOAuthFlow()` can await
    // `getAuthorizationResponse()` before initialization finishes.
    this.authorizing = true;
    this.initCancelled = false;
    const flow = createDeferred<NodeOAuthAuthorizationResponse>();
    this.lastFlow = flow;
    flow.promise.catch(() => {});

    try {
      if (this.shouldPersistSelectedPort) {
        await this.kv.set("port", String(this.port));
        this.shouldPersistSelectedPort = false;
      }

      if (this.initCancelled || this.lastFlow !== flow) {
        throw new OAuthFlowError("cancelled", "Flow cancelled");
      }

      const sanitizedUrl = await this.session.storeAuthorizationState(
        authorizationUrl,
        { flowType: "redirect" }
      );
      this.authorizationUrl = sanitizedUrl;

      if (this.initCancelled || this.lastFlow !== flow) {
        throw new OAuthFlowError("cancelled", "Flow cancelled");
      }

      await this.startLoopback();

      if (this.initCancelled || this.lastFlow !== flow) {
        this.stopLoopback();
        throw new OAuthFlowError("cancelled", "Flow cancelled");
      }

      this.pending = flow;
      this.authorizing = false;
    } catch (err) {
      if (this.lastFlow !== flow) {
        throw err;
      }
      this.authorizing = false;
      this.stopLoopback();
      const cancelled =
        this.initCancelled ||
        (err instanceof OAuthFlowError && err.code === "cancelled");
      let flowError: Error;
      if (cancelled) {
        flowError =
          err instanceof OAuthFlowError
            ? err
            : new OAuthFlowError("cancelled", "Flow cancelled");
      } else if (err instanceof Error) {
        flowError = err;
      } else {
        flowError = new Error(String(err));
      }
      flow.reject(flowError);
      throw flowError;
    }

    this.pendingTimer = setTimeout(() => {
      this.rejectPending(
        new OAuthFlowError(
          "timeout",
          `No callback received within ${this.authTimeoutMs}ms`
        )
      );
    }, this.authTimeoutMs);

    const opener = this.openBrowserOverride ?? defaultOpener;
    const launcherUrl = `http://127.0.0.1:${this.port}/authorize`;
    try {
      await opener(launcherUrl);
      // The local launcher redirects without exposing OAuth state in terminal
      // output when a CLI callback prints the opener URL for manual use.
    } catch (err) {
      // Non-fatal: we still print/keep listening so the user can paste.
      console.error(
        `[mcp-use] Could not open browser automatically: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  /**
   * Resolves with the authorization code captured by the loopback callback.
   *
   * @remarks This compatibility method omits the RFC 9207 issuer. OAuth flow
   * orchestrators should use {@link getAuthorizationResponse} when available.
   * Must be called after `redirectToAuthorization()`. Returns the same
   * promise whether the callback has fired or not — callers may subscribe
   * before or after.
   *
   * @returns The authorization code received by the loopback callback.
   */
  getAuthorizationCode(): Promise<string> {
    return this.getAuthorizationResponse().then((response) => response.code);
  }

  /**
   * Resolves with the authorization code and RFC 9207 issuer captured by the
   * loopback callback.
   *
   * @returns The loopback authorization response.
   * @throws When called before {@link NodeOAuthClientProvider.redirectToAuthorization}.
   */
  getAuthorizationResponse(): Promise<NodeOAuthAuthorizationResponse> {
    if (!this.lastFlow) {
      return Promise.reject(
        new Error(
          "NodeOAuthClientProvider.getAuthorizationResponse() called before redirectToAuthorization()"
        )
      );
    }
    return this.lastFlow.promise;
  }

  /**
   * Cancel an in-progress flow (timeout, SIGINT, etc.) and close the loopback.
   *
   * Pending calls to {@link NodeOAuthClientProvider.getAuthorizationResponse}
   * reject with an {@link OAuthFlowError} whose code is `"cancelled"`.
   */
  dispose(): void {
    this.initCancelled = true;
    this.authorizing = false;
    if (this.pending) {
      this.rejectPending(new OAuthFlowError("cancelled", "Flow cancelled"));
    } else {
      this.stopLoopback();
      this.lastFlow?.reject(new OAuthFlowError("cancelled", "Flow cancelled"));
    }
  }

  /** Local callback port, useful for status output and tests. */
  get callbackPort(): number {
    return this.port;
  }

  /**
   * True if `redirectToAuthorization()` has been called and we're awaiting
   * a callback (loopback bound, browser opened). Lets orchestrators detect
   * when the SDK transport has already kicked off the flow on a 401, so they
   * can skip straight to `getAuthorizationCode()` instead of calling `auth()`
   * again (which would throw "already in progress").
   */
  get hasPendingFlow(): boolean {
    return this.pending !== null || this.authorizing;
  }

  // --- Loopback internals ---

  private async startLoopback(): Promise<void> {
    if (this.server) return;
    const server = createHttpServer((req, res) => {
      this.handleCallback(req.url ?? "/", res);
    });
    // Track the server during binding so dispose() can find it.
    this.server = server;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(this.port, "127.0.0.1", () => {
          server.removeListener("error", reject);
          resolve();
        });
      });
    } catch (err) {
      if (this.server === server) {
        this.server = null;
      }
      server.close();
      throw err;
    }
  }

  private stopLoopback(): void {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    this.authorizationUrl = null;
  }

  private resolvePending(response: NodeOAuthAuthorizationResponse): void {
    const p = this.pending;
    this.pending = null;
    this.stopLoopback();
    p?.resolve(response);
  }

  private rejectPending(err: Error): void {
    const p = this.pending;
    this.pending = null;
    this.stopLoopback();
    p?.reject(err);
  }

  private handleCallback(
    rawUrl: string,
    res: import("node:http").ServerResponse
  ): void {
    const url = new URL(rawUrl, `http://127.0.0.1:${this.port}`);

    if (url.pathname === "/authorize") {
      if (this.authorizationUrl === null || this.pending === null) {
        res.statusCode = 410;
        res.end("Authorization flow is not active");
        return;
      }
      res.statusCode = 302;
      res.setHeader("location", this.authorizationUrl);
      res.setHeader("cache-control", "no-store");
      res.setHeader("referrer-policy", "no-referrer");
      res.end();
      return;
    }

    if (url.pathname !== "/callback") {
      res.statusCode = 404;
      res.end("Not Found");
      return;
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const iss = url.searchParams.get("iss") ?? undefined;
    const err = url.searchParams.get("error");
    const errDesc = url.searchParams.get("error_description") ?? undefined;

    if (err) {
      res.statusCode = 400;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(FAILURE_HTML(err, errDesc));
      this.rejectPending(new OAuthFlowError(err, errDesc));
      return;
    }

    if (!code || !state) {
      res.statusCode = 400;
      res.end("Missing code or state");
      // Don't reject — the user might retry; let timeout do the cleanup.
      return;
    }

    res.statusCode = 200;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(SUCCESS_HTML);
    this.resolvePending({ code, ...(iss !== undefined ? { iss } : {}) });
  }
}

async function defaultOpener(url: string): Promise<void> {
  // Best-effort fallback. CLI passes a richer override (the `open` package).
  const { spawn } = await import("node:child_process");
  const { platform } = await import("node:process");
  const cmd =
    platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

/**
 * Creates a Node OAuth provider for an MCP server.
 *
 * @param serverUrl - Protected MCP server URL.
 * @param options - OAuth metadata, storage, loopback, and browser options.
 * @returns A provider compatible with the MCP SDK OAuth flow.
 */
export async function createOAuthProvider(
  serverUrl: string,
  options: NodeOAuthOptions = {}
): Promise<OAuthClientProvider> {
  return NodeOAuthClientProvider.create(serverUrl, options);
}

export type { NodeOAuthOptions as OAuthProviderOptions };
