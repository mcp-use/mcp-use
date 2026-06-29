import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformation,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { createServer as createNetServer } from "node:net";
import { createServer as createHttpServer, type Server } from "node:http";
import { FileKVStore } from "./file-kv-store.js";
import type { KVStore } from "./kv-store.js";
import {
  OAuthSessionStore,
  type OAuthSessionStoreOptions,
} from "./oauth-session-store.js";

const DEFAULT_PORT = 33418;
const PORT_RANGE = 10;
const DEFAULT_AUTH_TIMEOUT_MS = 5 * 60_000;

export interface NodeOAuthOptions extends OAuthSessionStoreOptions {
  /** Preferred loopback port. Default 33418. Walks up by `portRange` on EADDRINUSE. */
  preferredPort?: number;
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

export class OAuthFlowError extends Error {
  readonly code: string;
  readonly description?: string;
  constructor(code: string, description?: string) {
    super(description ? `${code}: ${description}` : code);
    this.code = code;
    this.description = description;
    this.name = "OAuthFlowError";
  }
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
  readonly serverUrl: string;
  readonly port: number;

  private session: OAuthSessionStore;
  private kv: KVStore;
  private authTimeoutMs: number;
  private openBrowserOverride?: (url: string) => Promise<void> | void;

  private server: Server | null = null;
  /** Currently in-flight deferred — used to prevent overlapping flows. */
  private pending: Deferred<string> | null = null;
  /** Latest deferred (settled or in-flight) — what `getAuthorizationCode()` returns. */
  private lastFlow: Deferred<string> | null = null;
  private pendingTimer: NodeJS.Timeout | null = null;

  private constructor(
    serverUrl: string,
    port: number,
    session: OAuthSessionStore,
    kv: KVStore,
    options: NodeOAuthOptions
  ) {
    this.serverUrl = serverUrl;
    this.port = port;
    this.session = session;
    this.kv = kv;
    this.authTimeoutMs = options.authTimeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS;
    this.openBrowserOverride = options.openBrowser;
  }

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

    if (port !== persistedPort) {
      await kv.set("port", String(port));
    }

    const callbackUrl = `http://127.0.0.1:${port}/callback`;
    const session = new OAuthSessionStore(
      serverUrl,
      { ...options, callbackUrl },
      kv
    );

    return new NodeOAuthClientProvider(serverUrl, port, session, kv, options);
  }

  // --- Identity passthroughs (parallel to BrowserOAuthClientProvider) ---

  get storageKeyPrefix(): string {
    return this.session.storageKeyPrefix;
  }

  get serverUrlHash(): string {
    return this.session.serverUrlHash;
  }

  // --- SDK Interface (delegated to OAuthSessionStore) ---

  get redirectUrl(): string {
    return this.session.redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return this.session.clientMetadata;
  }

  tokens(): Promise<OAuthTokens | undefined> {
    return this.session.tokens();
  }

  saveTokens(tokens: OAuthTokens): Promise<void> {
    return this.session.saveTokens(tokens);
  }

  clientInformation(): Promise<OAuthClientInformation | undefined> {
    return this.session.clientInformation();
  }

  saveClientInformation(info: OAuthClientInformation): Promise<void> {
    return this.session.saveClientInformation(info);
  }

  codeVerifier(): Promise<string> {
    return this.session.codeVerifier();
  }

  saveCodeVerifier(codeVerifier: string): Promise<void> {
    return this.session.saveCodeVerifier(codeVerifier);
  }

  invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier"
  ): Promise<void> {
    return this.session.invalidateCredentials(scope);
  }

  /**
   * Bind the loopback server, set up the pending-code deferred, and ask the
   * platform to open the user's browser. Does NOT await the code; the
   * orchestrator awaits via `getAuthorizationCode()`.
   */
  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    if (this.pending) {
      throw new Error(
        "NodeOAuthClientProvider: an authorization is already in progress"
      );
    }

    const sanitizedUrl = await this.session.storeAuthorizationState(
      authorizationUrl,
      { flowType: "redirect" }
    );

    await this.startLoopback();

    this.pending = createDeferred<string>();
    this.lastFlow = this.pending;
    // Swallow unhandled rejections — callers may not subscribe before the
    // callback fires, but `getAuthorizationCode()` still returns the same
    // settled promise so the rejection is observable when awaited.
    this.pending.promise.catch(() => {});
    this.pendingTimer = setTimeout(() => {
      this.rejectPending(
        new OAuthFlowError(
          "timeout",
          `No callback received within ${this.authTimeoutMs}ms`
        )
      );
    }, this.authTimeoutMs);

    const opener = this.openBrowserOverride ?? defaultOpener;
    try {
      await opener(sanitizedUrl);
      // Browser opened (or queued). Caller will print the URL too — see CLI.
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
   * Must be called after `redirectToAuthorization()`. Returns the same
   * promise whether the callback has fired or not — callers may subscribe
   * before or after.
   */
  getAuthorizationCode(): Promise<string> {
    if (!this.lastFlow) {
      return Promise.reject(
        new Error(
          "NodeOAuthClientProvider.getAuthorizationCode() called before redirectToAuthorization()"
        )
      );
    }
    return this.lastFlow.promise;
  }

  /**
   * Force-refresh the access token using the persisted refresh_token.
   * Returns the new tokens on success, or null if no refresh_token / refresh failed.
   */
  forceRefresh(): Promise<OAuthTokens | null> {
    return this.session.forceRefresh();
  }

  /**
   * Cancel an in-progress flow (timeout, SIGINT, etc.) and close the loopback.
   */
  dispose(): void {
    if (this.pending) {
      this.rejectPending(new OAuthFlowError("cancelled", "Flow cancelled"));
    } else {
      this.stopLoopback();
    }
  }

  /** Best-effort port for tests / status output. */
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
    return this.pending !== null;
  }

  // --- Loopback internals ---

  private async startLoopback(): Promise<void> {
    if (this.server) return;
    const server = createHttpServer((req, res) => {
      this.handleCallback(req.url ?? "/", res);
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.port, "127.0.0.1", () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
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
  }

  private resolvePending(code: string): void {
    const p = this.pending;
    this.pending = null;
    this.stopLoopback();
    p?.resolve(code);
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

    if (url.pathname !== "/callback") {
      res.statusCode = 404;
      res.end("Not Found");
      return;
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
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
    this.resolvePending(code);
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
