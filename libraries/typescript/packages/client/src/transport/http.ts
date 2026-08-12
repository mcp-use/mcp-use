import {
  Client,
  discoverOAuthProtectedResourceMetadata,
  SdkError,
  SdkHttpError,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  type ClientOptions,
  type OAuthClientProvider,
  type VersionNegotiationMode,
} from "@modelcontextprotocol/client";
import { completeOAuthFlow, isOAuthInteractionRequired } from "../auth/flow.js";
import type { MCPAuthorizationInfo } from "../core/session.js";
import { DialectJsonSchemaValidator } from "../utils/json-schema-validator.js";
import { logger } from "../utils/logging.js";
import type { ConnectorInitOptions } from "./base.js";
import { BaseConnector } from "./base.js";

const MIXED_AUTH_DISCOVERY_TIMEOUT_MS = 2_000;

/**
 * Detect a 401 anywhere in an error / cause chain. Under
 * `versionNegotiation: "auto"` a connect-time 401 can surface wrapped as
 * `SdkError(EraNegotiationFailed)` with the `UnauthorizedError` at
 * `error.data.cause` (rather than a bare `SdkHttpError`), so we walk the chain.
 */
function detectUnauthorized(err: unknown, depth = 0): boolean {
  if (!err || depth > 5) return false;
  if (err instanceof UnauthorizedError) return true;
  if (err instanceof SdkHttpError && err.status === 401) return true;
  if (err instanceof Error) {
    if (err.cause) {
      if (detectUnauthorized(err.cause, depth + 1)) return true;
    }
    const data = err instanceof SdkError ? (err.data as any) : undefined;
    if (data?.cause && detectUnauthorized(data.cause, depth + 1)) return true;
  }
  return false;
}

/** Client identity advertised to an MCP server during connection setup. */
export type ClientInfo = {
  /** Stable programmatic client name. */
  name: string;
  /** Optional human-readable client title. */
  title?: string;
  /** Client version string. */
  version: string;
  /** Human-readable client description. */
  description?: string;
  /** Icons representing the client. */
  icons?: Array<{
    /** Icon URL. */
    src: string;
    /** Icon media type. */
    mimeType?: string;
    /** Supported icon sizes, such as `"48x48"`. */
    sizes?: string[];
  }>;
  /** Public website describing the client. */
  websiteUrl?: string;
};

/** HTTP-specific connector options. */
interface HttpConnectorOptions extends ConnectorInitOptions {
  /** Bearer token added to the `Authorization` header. */
  authToken?: string;
  /** Fetch implementation used by transport requests. */
  fetch?: typeof fetch;
  /** Additional transport request headers. */
  headers?: Record<string, string>;
  /** Connection timeout in milliseconds. Defaults to `10000`. */
  timeout?: number;
  /** Client identity advertised to the server. */
  clientInfo?: ClientInfo;
  /**
   * Protocol version negotiation mode passed to the SDK `Client`.
   * - `"auto"` (mcp-use HTTP default): probe with `server/discover`, falling
   *   back to the 2025 handshake against legacy servers.
   * - `"legacy"`: classic 2025 `initialize` handshake, no probe. This matches
   *   the official SDK's default when used directly.
   * - In auto mode, the probe performs OAuth discovery on auth-required
   *   servers and can fail on servers whose
   *   authorization-server issuer differs from the server URL (RFC 8414 §3.3),
   *   which would otherwise mask the normal 401 → auth flow.
   * - `{ pin: "2026-07-28" }`: modern era only, no fallback.
   */
  protocolNegotiation?: VersionNegotiationMode;
  /** Gateway endpoint through which MCP transport requests are routed. */
  gatewayUrl?: string;
  /** Server identifier forwarded to the gateway for observability. */
  serverId?: string;
  /** Retry settings for streamable HTTP reconnection. */
  reconnectionOptions?: {
    /** Maximum delay between reconnection attempts in milliseconds. */
    maxReconnectionDelay?: number;
    /** Delay before the first reconnection attempt in milliseconds. */
    initialReconnectionDelay?: number;
    /** Multiplier applied after each failed attempt. */
    reconnectionDelayGrowFactor?: number;
    /** Maximum number of reconnection attempts. */
    maxRetries?: number;
  };
  /** Detect RFC 9728 metadata after anonymous connection. Defaults to true. */
  detectMixedAuth?: boolean;
}

type StreamableHttpFailure = {
  fallbackReason: string;
  is401Error: boolean;
  httpStatusCode?: number;
};

function isOAuthClientProvider(
  provider: ConnectorInitOptions["authProvider"]
): provider is OAuthClientProvider {
  return Boolean(
    provider &&
    "redirectToAuthorization" in provider &&
    typeof provider.redirectToAuthorization === "function" &&
    "tokens" in provider &&
    typeof provider.tokens === "function"
  );
}

function createMcpProxyFetch(
  logicalServerUrl: string,
  proxyUrl: string,
  baseFetch: typeof fetch,
  serverId?: string
): typeof fetch {
  const logical = new URL(logicalServerUrl);
  const proxy = proxyUrl.replace(/\/$/, "");

  return async (input, init) => {
    const request = new Request(input, init);
    const requestUrl = new URL(request.url);
    const isMcpTransportRequest =
      requestUrl.origin === logical.origin &&
      requestUrl.pathname === logical.pathname;

    // OAuth discovery/token requests deliberately keep their own URLs so a
    // separately injected OAuth BFF fetch can handle them.
    if (!isMcpTransportRequest) {
      return baseFetch(request);
    }

    const headers = new Headers(request.headers);
    headers.set("X-Target-URL", request.url);
    if (serverId) headers.set("X-Server-Id", serverId);

    const body =
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.clone().arrayBuffer();

    return baseFetch(
      new Request(proxy, {
        method: request.method,
        headers,
        body,
        signal: request.signal,
        redirect: "manual",
      })
    );
  };
}

function createDeadlineFetch(
  baseFetch: typeof fetch,
  deadlineSignal: AbortSignal
): typeof fetch {
  return async (input, init) => {
    const requestSignal = init?.signal;
    if (!requestSignal) {
      return baseFetch(input, { ...init, signal: deadlineSignal });
    }

    const controller = new AbortController();
    const abortFromRequest = () => controller.abort(requestSignal.reason);
    const abortFromDeadline = () => controller.abort(deadlineSignal.reason);

    if (requestSignal.aborted) abortFromRequest();
    else
      requestSignal.addEventListener("abort", abortFromRequest, { once: true });

    if (deadlineSignal.aborted) abortFromDeadline();
    else
      deadlineSignal.addEventListener("abort", abortFromDeadline, {
        once: true,
      });

    try {
      return await baseFetch(input, { ...init, signal: controller.signal });
    } finally {
      requestSignal.removeEventListener("abort", abortFromRequest);
      deadlineSignal.removeEventListener("abort", abortFromDeadline);
    }
  };
}

/**
 * Connects to an MCP server using streamable HTTP.
 *
 * The connector negotiates modern and legacy protocol eras by default and can
 * route transport requests through an HTTP gateway.
 */
export class HttpConnector extends BaseConnector {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly timeout: number;
  private readonly customFetch?: typeof fetch;
  private readonly clientInfo: ClientInfo;
  private readonly protocolNegotiation: VersionNegotiationMode;
  private readonly gatewayUrl?: string;
  private readonly serverId?: string;
  private readonly reconnectionOptions?: HttpConnectorOptions["reconnectionOptions"];
  private readonly detectMixedAuth: boolean;
  private transportType: "streamable-http" | null = null;
  private streamableTransport: StreamableHTTPClientTransport | null = null;
  private hadAccessTokenAtConnect = false;
  private pendingOAuthCompletion: Promise<void> | null = null;
  private authorizationDiscovery: Promise<
    MCPAuthorizationInfo | undefined
  > | null = null;

  /**
   * Creates an HTTP connector.
   *
   * @param baseUrl - MCP endpoint URL.
   * @param opts - Authentication, transport, SDK, and reconnection options.
   */
  constructor(baseUrl: string, opts: HttpConnectorOptions = {}) {
    super(opts);

    const originalUrl = baseUrl.replace(/\/$/, "");
    this.baseUrl = originalUrl;
    this.headers = { ...(opts.headers ?? {}) };
    this.gatewayUrl = opts.gatewayUrl;
    this.serverId = opts.serverId;

    // Add auth token if provided
    if (opts.authToken) {
      this.headers.Authorization = `Bearer ${opts.authToken}`;
    }

    this.timeout = opts.timeout ?? 10000; // Default 10 seconds
    const baseFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.customFetch = this.gatewayUrl
      ? createMcpProxyFetch(
          originalUrl,
          this.gatewayUrl,
          baseFetch,
          this.serverId
        )
      : opts.fetch;
    this.clientInfo = opts.clientInfo ?? {
      name: "http-connector",
      version: "1.0.0",
    };
    // Negotiate the most capable protocol available. The SDK safely falls back
    // to the 2025 sessionful era for v1 servers while using v2's sessionless
    // server/discover flow when it is available.
    this.protocolNegotiation = opts.protocolNegotiation ?? "auto";
    this.reconnectionOptions = opts.reconnectionOptions;
    this.detectMixedAuth = opts.detectMixedAuth ?? true;
  }

  private get oauthProvider(): OAuthClientProvider | undefined {
    return isOAuthClientProvider(this.opts.authProvider)
      ? this.opts.authProvider
      : undefined;
  }

  private async completeInteractiveAuthorization(): Promise<void> {
    const provider = this.oauthProvider;
    if (!provider) {
      throw new Error("No OAuth client provider is configured");
    }
    if (!this.pendingOAuthCompletion) {
      this.pendingOAuthCompletion = completeOAuthFlow(provider, this.baseUrl, {
        fetchFn: this.customFetch,
        finishAuthorization: async (code, iss) => {
          const transport = this.streamableTransport;
          if (!transport) {
            throw new Error("OAuth transport is no longer connected");
          }
          await transport.finishAuth(code, iss);
        },
      })
        .then(() => {
          this.authorizationCache = {
            ...(this.authorizationCache ?? { mode: "mixed" }),
            authenticated: true,
          };
        })
        .finally(() => {
          this.pendingOAuthCompletion = null;
        });
    }
    await this.pendingOAuthCompletion;
  }

  protected override async executeRequest<T>(
    operation: () => Promise<T>
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const provider = this.oauthProvider as
        | (OAuthClientProvider & { preventAutoAuth?: boolean })
        | undefined;
      if (
        !provider ||
        provider.preventAutoAuth === true ||
        !isOAuthInteractionRequired(error)
      ) {
        throw error;
      }
      await this.completeInteractiveAuthorization();
      return operation();
    }
  }

  /** Authenticate an already-connected server without requiring a 401 first. */
  override async authenticate(): Promise<void> {
    if (!this.connected || !this.streamableTransport) {
      throw new Error("MCP client is not connected");
    }
    await this.completeInteractiveAuthorization();
  }

  override async discoverAuthorization(): Promise<
    MCPAuthorizationInfo | undefined
  > {
    if (
      !this.detectMixedAuth ||
      !this.oauthProvider ||
      this.hadAccessTokenAtConnect
    ) {
      return this.authorizationCache;
    }

    if (this.authorizationDiscovery) return this.authorizationDiscovery;

    this.authorizationDiscovery = this.discoverMixedAuthorization().then(
      (authorization) => {
        // A missing or temporarily unavailable RFC 9728 endpoint must not be
        // cached for the lifetime of an otherwise healthy MCP connection.
        if (!authorization) this.authorizationDiscovery = null;
        return authorization;
      }
    );
    return this.authorizationDiscovery;
  }

  private async discoverMixedAuthorization(): Promise<
    MCPAuthorizationInfo | undefined
  > {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const discoveryTimeout = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        const error = new Error(
          `Mixed-auth metadata discovery timed out after ${MIXED_AUTH_DISCOVERY_TIMEOUT_MS}ms`
        );
        controller.abort(error);
        reject(error);
      }, MIXED_AUTH_DISCOVERY_TIMEOUT_MS);
    });
    const baseFetch = this.customFetch ?? globalThis.fetch.bind(globalThis);

    try {
      const metadata = await Promise.race([
        discoverOAuthProtectedResourceMetadata(
          this.baseUrl,
          { protocolVersion: this.negotiatedProtocolVersion },
          createDeadlineFetch(baseFetch, controller.signal)
        ),
        discoveryTimeout,
      ]);
      this.authorizationCache = {
        mode: "mixed",
        authenticated: false,
        ...(metadata.resource ? { resource: metadata.resource } : {}),
        ...(metadata.scopes_supported
          ? { scopesSupported: [...metadata.scopes_supported] }
          : {}),
      };
      logger.info(
        "OAuth protected-resource metadata found after anonymous connection; server uses mixed auth"
      );
    } catch (error) {
      // RFC 9728 metadata is optional for anonymous servers. Discovery is a
      // best-effort classification and must never turn a valid MCP connection
      // into a failure.
      logger.debug("Mixed-auth metadata was not discovered:", error);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    return this.authorizationCache;
  }

  private buildClientOptions(): ClientOptions {
    return {
      ...(this.opts.clientOptions || {}),
      jsonSchemaValidator:
        this.opts.clientOptions?.jsonSchemaValidator ??
        new DialectJsonSchemaValidator(),
      versionNegotiation: {
        // Allow a caller-supplied versionNegotiation in clientOptions to win.
        mode: this.protocolNegotiation,
        ...(this.opts.clientOptions?.versionNegotiation ?? {}),
      },
      listChanged: {
        tools: {
          autoRefresh: true,
          onChanged: (error, tools) =>
            void this.handleListChanged(
              "notifications/tools/list_changed",
              error,
              tools
            ),
        },
        resources: {
          autoRefresh: false,
          onChanged: (error) =>
            void this.handleListChanged(
              "notifications/resources/list_changed",
              error
            ),
        },
        prompts: {
          autoRefresh: false,
          onChanged: (error) =>
            void this.handleListChanged(
              "notifications/prompts/list_changed",
              error
            ),
        },
        ...(this.opts.clientOptions?.listChanged ?? {}),
      },
      capabilities: {
        ...(this.opts.clientOptions?.capabilities || {}),
        roots: { listChanged: true },
        ...(this.opts.onSampling ? { sampling: {} } : {}),
        ...(this.opts.onElicitation
          ? { elicitation: { form: {}, url: {} } }
          : {}),
      },
    };
  }

  // In v2 HTTP transport errors are thrown as SdkHttpError (subclass of
  // SdkError) with a numeric `.status` accessor, replacing v1's
  // StreamableHTTPError (which carried the status on `.code`).
  private unwrapStreamableError(err: unknown): SdkHttpError | null {
    if (err instanceof SdkHttpError) {
      return err;
    }
    if (err instanceof Error && err.cause instanceof SdkHttpError) {
      return err.cause;
    }
    return null;
  }

  private classifyStreamableHttpFailure(err: unknown): StreamableHttpFailure {
    let fallbackReason = "Unknown error";
    let is401Error = false;
    let httpStatusCode: number | undefined;

    const streamableErr = this.unwrapStreamableError(err);
    if (streamableErr) {
      const status = streamableErr.status;
      is401Error = status === 401;
      httpStatusCode = status;

      if (
        status === 400 &&
        streamableErr.message.includes("Missing session ID")
      ) {
        fallbackReason = "Server requires session ID";
        logger.warn(`⚠️  ${fallbackReason}`);
      } else if (status === 404 || status === 405) {
        fallbackReason = `Server returned ${status} - server likely doesn't support streamable HTTP`;
        logger.debug(fallbackReason);
      } else {
        fallbackReason = `Server returned ${status}: ${streamableErr.message}`;
        logger.debug(fallbackReason);
      }

      return { fallbackReason, is401Error, httpStatusCode };
    }

    if (err instanceof Error) {
      const errorStr = err.toString();
      const errorMsg = err.message || "";
      is401Error =
        detectUnauthorized(err) ||
        errorStr.includes("401") ||
        errorMsg.includes("Unauthorized");

      if (
        errorStr.includes("Missing session ID") ||
        errorStr.includes("Bad Request: Missing session ID") ||
        errorMsg.includes("FastMCP session ID error")
      ) {
        fallbackReason = "Server requires session ID";
        logger.warn(`⚠️  ${fallbackReason}`);
      } else if (
        errorStr.includes("405 Method Not Allowed") ||
        errorStr.includes("404 Not Found")
      ) {
        fallbackReason = "Server doesn't support streamable HTTP (405/404)";
        logger.debug(fallbackReason);
      } else {
        fallbackReason = `Streamable HTTP failed: ${err.message}`;
        logger.debug(fallbackReason);
      }
    }

    return { fallbackReason, is401Error, httpStatusCode };
  }

  /**
   * Establishes a streamable HTTP connection to the MCP server.
   *
   * @returns A promise that resolves after protocol negotiation completes.
   * @throws An error with `code: 401` when authentication is required.
   */
  async connect(): Promise<void> {
    if (this.connected) {
      logger.debug("Already connected to MCP implementation");
      return;
    }

    const baseUrl = this.baseUrl;
    logger.debug(`Connecting to MCP implementation via HTTP: ${baseUrl}`);

    const oauthProvider = this.oauthProvider;
    if (oauthProvider) {
      try {
        this.hadAccessTokenAtConnect = Boolean(
          (await oauthProvider.tokens())?.access_token
        );
      } catch {
        this.hadAccessTokenAtConnect = false;
      }
    }

    try {
      await this.connectWithStreamableHttp(baseUrl);
      logger.debug("✅ Successfully connected via streamable HTTP");
    } catch (err: unknown) {
      logger.debug("Streamable HTTP connect failed", err);
      const { fallbackReason, is401Error, httpStatusCode } =
        this.classifyStreamableHttpFailure(err);

      await this.cleanupResources();

      if (is401Error) {
        logger.info("Authentication required");
        const authError = new Error("Authentication required") as any;
        authError.code = 401;
        throw authError;
      }

      const finalError = new Error(
        `Could not connect via streamable HTTP: ${fallbackReason}`
      );
      if (httpStatusCode !== undefined) {
        Object.defineProperty(finalError, "code", {
          value: httpStatusCode,
          writable: false,
          enumerable: true,
          configurable: true,
        });
      }
      throw finalError;
    }
  }

  /**
   * Tee an SSE response so v2 MRTR progress can be correlated even when the
   * upstream SDK does not carry the original callback to retry request IDs.
   */
  private observeSseProgress(response: Response): Response {
    if (
      !response.body ||
      !response.headers.get("content-type")?.includes("text/event-stream")
    ) {
      return response;
    }
    const [body, observed] = response.body.tee();
    void (async () => {
      const reader = observed.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split(/\r?\n\r?\n/);
          buffer = events.pop() ?? "";
          for (const event of events) {
            for (const line of event.split(/\r?\n/)) {
              if (!line.startsWith("data:")) continue;
              try {
                const message = JSON.parse(line.slice(5).trim()) as {
                  method?: string;
                  params?: unknown;
                };
                if (message.method === "notifications/progress") {
                  this.forwardRoundProgress(message.params);
                }
              } catch {
                // Ignore malformed/non-JSON SSE data; the SDK remains authoritative.
              }
            }
          }
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          logger.debug("Progress observer stream ended:", error);
        }
      } finally {
        reader.releaseLock();
      }
    })();
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  private async connectWithStreamableHttp(baseUrl: string): Promise<void> {
    try {
      logger.debug("[HttpConnector] Connecting with Streamable HTTP", {
        baseUrl,
        originalUrl: this.baseUrl,
        gatewayUrl: this.gatewayUrl || "none",
        authProviderUrl:
          this.opts.authProvider &&
          "serverUrl" in this.opts.authProvider &&
          typeof this.opts.authProvider.serverUrl === "string"
            ? this.opts.authProvider.serverUrl
            : "none",
        headers: this.headers,
      });

      let markPushStreamReady: (() => void) | undefined;
      const pushStreamReady = new Promise<void>((resolve) => {
        markPushStreamReady = resolve;
      });
      const baseFetch = this.customFetch ?? globalThis.fetch.bind(globalThis);
      const observedFetch: typeof fetch = async (input, init) => {
        const response = await baseFetch(input, init);
        const method =
          init?.method ?? (input instanceof Request ? input.method : "GET");
        const requestHeaders = new Headers(
          input instanceof Request ? input.headers : undefined
        );
        new Headers(init?.headers).forEach((value, key) => {
          requestHeaders.set(key, value);
        });
        if (
          method.toUpperCase() === "GET" &&
          response.ok &&
          response.headers.get("content-type")?.includes("text/event-stream")
        ) {
          markPushStreamReady?.();
        }
        // subscriptions/listen owns its SSE reader and acknowledgement state.
        // Re-wrapping that response breaks the SDK's per-request stream hooks;
        // the progress observer is only for ordinary request/response calls.
        return requestHeaders.get("mcp-method") === "subscriptions/listen"
          ? response
          : this.observeSseProgress(response);
      };

      // Create StreamableHTTPClientTransport directly
      // The official SDK's StreamableHTTPClientTransport automatically handles session IDs
      // when client.connect() is called - it sends initialize, gets session ID from response header,
      // and opens the SSE stream with that session ID
      const streamableTransport = new StreamableHTTPClientTransport(
        new URL(baseUrl),
        {
          authProvider: this.opts.authProvider, // ← Pass OAuth provider to SDK
          fetch: observedFetch,
          requestInit: {
            headers: this.headers,
          },
          reconnectionOptions: {
            maxReconnectionDelay: 30000,
            initialReconnectionDelay: 1000,
            reconnectionDelayGrowFactor: 1.5,
            maxRetries: 2,
            ...this.reconnectionOptions,
          },
          // Don't pass sessionId - let the SDK generate it automatically during connect()
        }
      );

      // Store transport for cleanup (we'll create ConnectionManager later if needed for reconnection)
      let transport: StreamableHTTPClientTransport = streamableTransport;

      // Wrap transport if wrapper is provided
      if (this.opts.wrapTransport) {
        const serverId = this.baseUrl; // Use URL as server ID for now
        transport = this.opts.wrapTransport(
          transport,
          serverId
        ) as StreamableHTTPClientTransport;
      }

      // Create and connect the client
      // This performs both initialize AND initialized notification
      // Always advertise roots capability - server may query roots/list even if client has no roots
      const clientOptions = this.buildClientOptions();
      logger.debug(
        `Creating Client with capabilities:`,
        JSON.stringify(clientOptions.capabilities, null, 2)
      );
      this.client = new Client(this.clientInfo, clientOptions);

      // Register inbound handlers BEFORE connect() so they are available for the
      // entire connection lifetime (including reverse RPC during/after initialize).
      this.setupRootsHandler();
      this.setupSamplingHandler();
      this.setupElicitationHandler();
      logger.debug(
        "Roots/sampling/elicitation handlers registered before connect"
      );

      try {
        // The SDK's StreamableHTTPClientTransport should automatically:
        // 1. Send POST initialize request
        // 2. Extract mcp-session-id from response header
        // 3. Open GET SSE stream with that session ID in header
        //
        // Keep the connection timeout outside the SDK request options so it
        // cannot leak onto streams opened during connection setup.
        let connectTimeout: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          this.client.connect(transport),
          new Promise<never>((_, reject) => {
            connectTimeout = setTimeout(
              () =>
                reject(
                  new Error(`MCP connection timed out after ${this.timeout}ms`)
                ),
              this.timeout
            );
          }),
        ]).finally(() => {
          if (connectTimeout !== undefined) clearTimeout(connectTimeout);
        });

        // The official SDK opens the v1 standalone GET stream in the
        // background after initialization. Wait until its response headers
        // arrive so reverse RPC and notifications cannot race connect().
        if (
          (this.client.getProtocolEra?.() ?? "legacy") === "legacy" &&
          streamableTransport.sessionId
        ) {
          let readinessTimeout: ReturnType<typeof setTimeout> | undefined;
          const attached = await Promise.race([
            pushStreamReady.then(() => true),
            new Promise<false>(
              (resolve) =>
                (readinessTimeout = setTimeout(
                  () => resolve(false),
                  Math.min(this.timeout, 5000)
                ))
            ),
          ]);
          if (readinessTimeout) clearTimeout(readinessTimeout);
          if (!attached) {
            logger.warn(
              "Legacy server push stream did not attach before connect completed"
            );
          }
        }

        // Streamable HTTP servers may optionally assign a session ID.
        const sessionId = streamableTransport.sessionId;
        if (sessionId) {
          logger.debug(`Session ID obtained: ${sessionId}`);
        }
      } catch (connectErr) {
        // Check if the error is due to missing session ID during connection handshake
        if (connectErr instanceof Error) {
          const errMsg = connectErr.message || connectErr.toString();
          if (
            errMsg.includes("Missing session ID") ||
            errMsg.includes("Bad Request: Missing session ID") ||
            errMsg.includes("Mcp-Session-Id header is required")
          ) {
            // Wrap it in a more specific error so the outer catch can detect it
            const wrappedError = new Error(
              `Session ID error: ${errMsg}. The SDK should automatically extract session ID from initialize response.`
            );
            wrappedError.cause = connectErr;
            throw wrappedError;
          }
        }
        throw connectErr;
      }

      // Store the transport for later cleanup
      this.streamableTransport = streamableTransport;
      // Create a minimal connection manager wrapper for cleanup purposes.
      // Note: terminateSession() is invoked from cleanupResources() *before*
      // the SDK's client.close() aborts the transport's abort controller.
      // Calling terminateSession() here would race the abort and surface a
      // spurious AbortError on every clean shutdown.
      this.connectionManager = {
        stop: async () => {
          if (this.streamableTransport) {
            try {
              await this.streamableTransport.close();
            } catch (e) {
              logger.warn(`Error closing Streamable HTTP transport: ${e}`);
            } finally {
              this.streamableTransport = null;
            }
          }
        },
      } as any;

      this.connected = true;
      this.transportType = "streamable-http";
      this.setupNotificationHandler();
      // Inbound request handlers (roots/sampling/elicitation) were registered before connect()
      logger.debug(
        `Successfully connected to MCP implementation via streamable HTTP: ${baseUrl}`
      );

      // Track connector initialization
      this.trackConnectorInit({
        serverUrl: this.baseUrl,
        publicIdentifier: `${this.baseUrl} (streamable-http)`,
      });
    } catch (err) {
      // Clean up partial resources before throwing
      await this.cleanupResources();
      throw err;
    }
  }

  /**
   * Returns fields that identify the endpoint and negotiated transport.
   *
   * @returns HTTP connector identity metadata.
   */
  get publicIdentifier(): Record<string, string> {
    return {
      type: "http",
      url: this.baseUrl,
      transport: this.transportType || "unknown",
      protocolEra: this.protocolEra ?? "unknown",
    };
  }

  /**
   * Returns the active transport type.
   *
   * @returns `"streamable-http"` after connection, otherwise `null`.
   */
  getTransportType(): "streamable-http" | null {
    return this.transportType;
  }

  // Send the streamable-HTTP DELETE *before* super.cleanupResources() invokes
  // client.close(). The SDK's transport.close() aborts the shared abort
  // controller, and terminateSession()'s DELETE fetch reuses that signal —
  // running it after close() rejects immediately with AbortError.
  protected async cleanupResources(): Promise<void> {
    // Only legacy (2025-era) connections carry an Mcp-Session-Id worth
    // terminating. Modern (2026-07-28) connections are stateless per-request,
    // so there is no session DELETE to issue.
    if (this.streamableTransport && this.protocolEra !== "modern") {
      let terminationTimeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const terminated = await Promise.race([
          this.streamableTransport.terminateSession().then(() => true),
          new Promise<false>(
            (resolve) =>
              (terminationTimeout = setTimeout(
                () => resolve(false),
                Math.min(this.timeout, 5000)
              ))
          ),
        ]);
        if (!terminated) {
          logger.debug(
            "Timed out terminating legacy HTTP session; closing transport"
          );
        }
      } catch (e) {
        logger.debug(`Error terminating Streamable HTTP session: ${e}`);
      } finally {
        if (terminationTimeout) clearTimeout(terminationTimeout);
      }
    }
    await super.cleanupResources();
    this.authorizationDiscovery = null;
  }
}
