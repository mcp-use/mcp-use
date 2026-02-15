import {
  Client,
  type ClientOptions,
} from "@modelcontextprotocol/sdk/client/index.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { logger } from "../logging.js";
import { SseConnectionManager } from "../task_managers/sse.js";
import type { ConnectorInitOptions } from "./base.js";
import { BaseConnector } from "./base.js";

export type ClientInfo = {
  name: string;
  title?: string;
  version: string;
  description?: string;
  icons?: Array<{
    src: string;
    mimeType?: string;
    sizes?: string[];
  }>;
  websiteUrl?: string;
};

export interface HttpConnectorOptions extends ConnectorInitOptions {
  authToken?: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
  timeout?: number; // HTTP request timeout (ms)
  sseReadTimeout?: number; // SSE read timeout (ms)
  clientInfo?: ClientInfo;
  preferSse?: boolean; // Force SSE transport instead of trying streamable HTTP first
  disableSseFallback?: boolean; // Disable automatic fallback to SSE when streamable HTTP fails (default: false)
  gatewayUrl?: string; // Optional gateway URL to route requests through
  serverId?: string; // Optional server ID for gateway observability
}

type StreamableHttpFailure = {
  fallbackReason: string;
  is401Error: boolean;
  httpStatusCode?: number;
};

export class HttpConnector extends BaseConnector {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly timeout: number;
  private readonly sseReadTimeout: number;
  private readonly customFetch?: typeof fetch;
  private readonly clientInfo: ClientInfo;
  private readonly preferSse: boolean;
  private readonly disableSseFallback: boolean;
  private readonly gatewayUrl?: string;
  private readonly serverId?: string;
  private transportType: "streamable-http" | "sse" | null = null;
  private streamableTransport: StreamableHTTPClientTransport | null = null;

  constructor(baseUrl: string, opts: HttpConnectorOptions = {}) {
    super(opts);

    // Store original URL before any gateway transformation
    const originalUrl = baseUrl.replace(/\/$/, "");

    // Gateway support: When using gateway, use gateway URL as the primary baseUrl
    // and store original URL in headers for proxy routing
    this.gatewayUrl = opts.gatewayUrl;
    this.serverId = opts.serverId;

    if (this.gatewayUrl) {
      // When using gateway, the transport should connect to gateway URL
      // and forward requests to original URL via X-Target-URL header
      this.baseUrl = this.gatewayUrl.replace(/\/$/, "");
      this.headers = { ...(opts.headers ?? {}) };
      this.headers["X-Target-URL"] = originalUrl;
      // Add server ID header for observability tracking
      if (this.serverId) {
        this.headers["X-Server-Id"] = this.serverId;
      }
    } else {
      // No gateway - use original URL directly
      this.baseUrl = originalUrl;
      this.headers = { ...(opts.headers ?? {}) };
    }

    // Add auth token if provided
    if (opts.authToken) {
      this.headers.Authorization = `Bearer ${opts.authToken}`;
    }

    this.timeout = opts.timeout ?? 10000; // Default 10 seconds
    this.sseReadTimeout = opts.sseReadTimeout ?? 300000; // Default 5 minutes
    this.customFetch = opts.fetch;
    this.clientInfo = opts.clientInfo ?? {
      name: "http-connector",
      version: "1.0.0",
    };
    this.preferSse = opts.preferSse ?? false;
    this.disableSseFallback = opts.disableSseFallback ?? false;
  }

  private buildClientOptions(): ClientOptions {
    return {
      ...(this.opts.clientOptions || {}),
      capabilities: {
        ...(this.opts.clientOptions?.capabilities || {}),
        roots: { listChanged: true },
        ...(this.opts.onSampling ? { sampling: {} } : {}),
        ...((this.opts.onElicitation ?? this.opts.elicitationCallback)
          ? { elicitation: { form: {}, url: {} } }
          : {}),
      },
    };
  }

  private unwrapStreamableError(err: unknown): StreamableHTTPError | null {
    if (err instanceof StreamableHTTPError) {
      return err;
    }
    if (err instanceof Error && err.cause instanceof StreamableHTTPError) {
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
      is401Error = streamableErr.code === 401;
      httpStatusCode = streamableErr.code;

      if (
        streamableErr.code === 400 &&
        streamableErr.message.includes("Missing session ID")
      ) {
        fallbackReason =
          "Server requires session ID (FastMCP compatibility) - using SSE transport";
        logger.warn(`⚠️  ${fallbackReason}`);
      } else if (streamableErr.code === 404 || streamableErr.code === 405) {
        fallbackReason = `Server returned ${streamableErr.code} - server likely doesn't support streamable HTTP`;
        logger.debug(fallbackReason);
      } else {
        fallbackReason = `Server returned ${streamableErr.code}: ${streamableErr.message}`;
        logger.debug(fallbackReason);
      }

      return { fallbackReason, is401Error, httpStatusCode };
    }

    if (err instanceof Error) {
      const errorStr = err.toString();
      const errorMsg = err.message || "";
      is401Error =
        errorStr.includes("401") || errorMsg.includes("Unauthorized");

      if (
        errorStr.includes("Missing session ID") ||
        errorStr.includes("Bad Request: Missing session ID") ||
        errorMsg.includes("FastMCP session ID error")
      ) {
        fallbackReason =
          "Server requires session ID (FastMCP compatibility) - using SSE transport";
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

  /** Establish connection to the MCP implementation via HTTP (streamable or SSE). */
  async connect(): Promise<void> {
    if (this.connected) {
      logger.debug("Already connected to MCP implementation");
      return;
    }

    // baseUrl is already set correctly in constructor:
    // - If gateway is configured: baseUrl = gateway URL (with X-Target-URL header)
    // - If no gateway: baseUrl = original URL
    const baseUrl = this.baseUrl;

    // If preferSse is set, skip directly to SSE
    if (this.preferSse) {
      logger.debug(`Connecting to MCP implementation via HTTP/SSE: ${baseUrl}`);
      await this.connectWithSse(baseUrl);
      return;
    }

    // Try streamable HTTP first, then fall back to SSE
    logger.debug(`Connecting to MCP implementation via HTTP: ${baseUrl}`);

    try {
      // Try streamable HTTP transport first
      logger.info("🔄 Attempting streamable HTTP transport...");
      await this.connectWithStreamableHttp(baseUrl);
      logger.info("✅ Successfully connected via streamable HTTP");
    } catch (err: unknown) {
      logger.debug("Streamable HTTP connect failed", err);
      const { fallbackReason, is401Error, httpStatusCode } =
        this.classifyStreamableHttpFailure(err);

      // Don't fallback on 401 - SSE will fail too
      if (is401Error) {
        logger.info("Authentication required - skipping SSE fallback");
        await this.cleanupResources();
        const authError = new Error("Authentication required") as any;
        authError.code = 401;
        throw authError;
      }

      if (this.disableSseFallback) {
        logger.info("SSE fallback disabled - failing connection");
        await this.cleanupResources();
        throw new Error(`Streamable HTTP connection failed: ${fallbackReason}`);
      }

      // Always try SSE fallback for maximum compatibility
      logger.info("🔄 Falling back to SSE transport...");

      try {
        await this.connectWithSse(baseUrl);
      } catch (sseErr: any) {
        logger.error("Failed to connect with both transports:");
        logger.error(`  Streamable HTTP: ${fallbackReason}`);
        logger.error(`  SSE: ${sseErr}`);
        await this.cleanupResources();

        // Preserve 401 error code if SSE also failed with 401
        const sseIs401 =
          sseErr?.message?.includes("401") ||
          sseErr?.message?.includes("Unauthorized");
        if (sseIs401) {
          const authError = new Error("Authentication required") as any;
          authError.code = 401;
          throw authError;
        }

        // Preserve original HTTP status code if it was captured
        // This allows useMcp's proxy fallback to detect 4xx errors
        const finalError = new Error(
          `Could not connect to server with any available transport. Streamable HTTP: ${fallbackReason}`
        );

        if (httpStatusCode !== undefined) {
          // Use Object.defineProperty to ensure the code property is properly set and accessible
          Object.defineProperty(finalError, "code", {
            value: httpStatusCode,
            writable: false,
            enumerable: true,
            configurable: true,
          });
          logger.debug(
            `Preserving HTTP status code ${httpStatusCode} in error for proxy fallback detection`
          );
        }

        throw finalError;
      }
    }
  }

  private async connectWithStreamableHttp(baseUrl: string): Promise<void> {
    try {
      logger.debug("[HttpConnector] Connecting with Streamable HTTP", {
        baseUrl,
        originalUrl: this.baseUrl,
        gatewayUrl: this.gatewayUrl || "none",
        authProviderUrl: this.opts.authProvider?.serverUrl || "none",
        headers: this.headers,
      });

      // Create StreamableHTTPClientTransport directly
      // The official SDK's StreamableHTTPClientTransport automatically handles session IDs
      // when client.connect() is called - it sends initialize, gets session ID from response header,
      // and opens the SSE stream with that session ID
      const streamableTransport = new StreamableHTTPClientTransport(
        new URL(baseUrl),
        {
          authProvider: this.opts.authProvider, // ← Pass OAuth provider to SDK
          fetch: this.customFetch,
          requestInit: {
            headers: this.headers,
          },
          // Pass through reconnection options
          reconnectionOptions: {
            maxReconnectionDelay: 30000,
            initialReconnectionDelay: 1000,
            reconnectionDelayGrowFactor: 1.5,
            maxRetries: 2, // Disable automatic reconnection - let higher-level logic handle it
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

      // IMPORTANT: Set up roots handler BEFORE connect() so it's available during initialize handshake
      // The server may call roots/list during initialization if it advertises roots capability
      this.setupRootsHandler();
      logger.debug("Roots handler registered before connect");

      try {
        // Connect with timeout
        // The SDK's StreamableHTTPClientTransport should automatically:
        // 1. Send POST initialize request
        // 2. Extract mcp-session-id from response header
        // 3. Open GET SSE stream with that session ID in header
        await this.client.connect(transport, {
          timeout: this.timeout,
        });

        // Verify session ID is available after connect
        // The transport should have the session ID from the initialize response
        const sessionId = streamableTransport.sessionId;
        if (sessionId) {
          logger.debug(`Session ID obtained: ${sessionId}`);
        } else {
          logger.warn(
            "Session ID not available after connect - this may cause issues with SSE stream"
          );
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
      // Create a minimal connection manager wrapper for cleanup purposes
      this.connectionManager = {
        stop: async () => {
          if (this.streamableTransport) {
            try {
              // First terminate the session per MCP spec (sends DELETE request)
              await this.streamableTransport.terminateSession();
              // Then close the transport
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
      this.setupSamplingHandler();
      this.setupElicitationHandler();
      // Note: setupRootsHandler() is called BEFORE connect() to handle roots/list during initialization
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

  private async connectWithSse(baseUrl: string): Promise<void> {
    try {
      // Create and start the SSE connection manager
      // Note: The MCP SDK's SSEClientTransport doesn't expose timeout configuration directly
      // Timeout handling is managed by the underlying EventSource and fetch implementations
      this.connectionManager = new SseConnectionManager(baseUrl, {
        authProvider: this.opts.authProvider, // ← Pass OAuth provider to SDK (same as streamable HTTP)
        requestInit: {
          headers: this.headers,
        },
      });
      let transport = await this.connectionManager.start();

      // Wrap transport if wrapper is provided
      if (this.opts.wrapTransport) {
        const serverId = this.baseUrl; // Use URL as server ID for now
        transport = this.opts.wrapTransport(transport, serverId);
      }

      // Create and connect the client
      // Always advertise roots capability - server may query roots/list even if client has no roots
      const clientOptions = this.buildClientOptions();
      logger.debug(
        `Creating Client with capabilities (SSE):`,
        JSON.stringify(clientOptions.capabilities, null, 2)
      );
      this.client = new Client(this.clientInfo, clientOptions);

      // IMPORTANT: Set up roots handler BEFORE connect() so it's available during initialize handshake
      // The server may call roots/list during initialization if it advertises roots capability
      this.setupRootsHandler();
      logger.debug("Roots handler registered before connect (SSE)");

      await this.client.connect(transport);

      this.connected = true;
      this.transportType = "sse";
      this.setupNotificationHandler();
      this.setupSamplingHandler();
      this.setupElicitationHandler();
      // Note: setupRootsHandler() is called BEFORE connect() to handle roots/list during initialization
      logger.debug(
        `Successfully connected to MCP implementation via HTTP/SSE: ${baseUrl}`
      );

      // Track connector initialization
      this.trackConnectorInit({
        serverUrl: this.baseUrl,
        publicIdentifier: `${this.baseUrl} (sse)`,
      });
    } catch (err) {
      // Clean up partial resources before throwing
      await this.cleanupResources();
      throw err;
    }
  }

  get publicIdentifier(): Record<string, string> {
    return {
      type: "http",
      url: this.baseUrl,
      transport: this.transportType || "unknown",
    };
  }

  /**
   * Get the transport type being used (streamable-http or sse)
   */
  getTransportType(): "streamable-http" | "sse" | null {
    return this.transportType;
  }
}
