import { Client, type ClientOptions } from "@modelcontextprotocol/client";
import {
  StreamableHTTPClientTransport,
  SdkHttpError,
} from "@modelcontextprotocol/client";
import { logger } from "../logging.js";
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

interface HttpConnectorOptions extends ConnectorInitOptions {
  authToken?: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
  timeout?: number; // HTTP request timeout (ms)
  sseReadTimeout?: number; // SSE read timeout (ms)
  clientInfo?: ClientInfo;
  gatewayUrl?: string; // Optional gateway URL to route requests through
  serverId?: string; // Optional server ID for gateway observability
  reconnectionOptions?: {
    maxReconnectionDelay?: number;
    initialReconnectionDelay?: number;
    reconnectionDelayGrowFactor?: number;
    maxRetries?: number;
  };
}

type StreamableHttpFailure = {
  reason: string;
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
  private readonly gatewayUrl?: string;
  private readonly serverId?: string;
  private readonly reconnectionOptions?: HttpConnectorOptions["reconnectionOptions"];
  private transportType: "streamable-http" | null = null;
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
    this.reconnectionOptions = opts.reconnectionOptions;
  }

  private buildClientOptions(): ClientOptions {
    return {
      ...(this.opts.clientOptions || {}),
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
    let reason = "Unknown error";
    let is401Error = false;
    let httpStatusCode: number | undefined;

    const streamableErr = this.unwrapStreamableError(err);
    if (streamableErr) {
      // ponytail: v2 types SdkHttpError.code as SdkErrorCode; runtime uses HTTP status
      const httpCode = streamableErr.code as unknown as number;
      is401Error = httpCode === 401;
      httpStatusCode = httpCode;

      if (
        httpCode === 400 &&
        streamableErr.message.includes("Missing session ID")
      ) {
        reason =
          "Server requires session ID (FastMCP compatibility) but streamable HTTP failed";
        logger.warn(`⚠️  ${reason}`);
      } else if (httpCode === 404 || httpCode === 405) {
        reason = `Server returned ${httpCode} - server likely doesn't support streamable HTTP`;
        logger.debug(reason);
      } else {
        reason = `Server returned ${httpCode}: ${streamableErr.message}`;
        logger.debug(reason);
      }

      return { reason, is401Error, httpStatusCode };
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
        reason =
          "Server requires session ID (FastMCP compatibility) but streamable HTTP failed";
        logger.warn(`⚠️  ${reason}`);
      } else if (
        errorStr.includes("405 Method Not Allowed") ||
        errorStr.includes("404 Not Found")
      ) {
        reason = "Server doesn't support streamable HTTP (405/404)";
        logger.debug(reason);
      } else {
        reason = `Streamable HTTP failed: ${err.message}`;
        logger.debug(reason);
      }
    }

    return { reason, is401Error, httpStatusCode };
  }

  /** Establish connection to the MCP implementation via streamable HTTP. */
  async connect(): Promise<void> {
    if (this.connected) {
      logger.debug("Already connected to MCP implementation");
      return;
    }

    const baseUrl = this.baseUrl;
    logger.debug(`Connecting to MCP implementation via HTTP: ${baseUrl}`);

    try {
      logger.debug("🔄 Attempting streamable HTTP transport...");
      await this.connectWithStreamableHttp(baseUrl);
      logger.debug("✅ Successfully connected via streamable HTTP");
    } catch (err: unknown) {
      logger.debug("Streamable HTTP connect failed", err);
      const { reason, is401Error } = this.classifyStreamableHttpFailure(err);

      if (is401Error) {
        logger.info("Authentication required");
        await this.cleanupResources();
        const authError = new Error("Authentication required") as Error & {
          code: number;
        };
        authError.code = 401;
        throw authError;
      }

      await this.cleanupResources();
      throw new Error(`Streamable HTTP connection failed: ${reason}`);
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

      const streamableTransport = new StreamableHTTPClientTransport(
        new URL(baseUrl),
        {
          authProvider: this.opts.authProvider,
          fetch: this.customFetch,
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
        }
      );

      let transport: StreamableHTTPClientTransport = streamableTransport;

      if (this.opts.wrapTransport) {
        const serverId = this.baseUrl;
        transport = this.opts.wrapTransport(
          transport,
          serverId
        ) as StreamableHTTPClientTransport;
      }

      const clientOptions = this.buildClientOptions();
      logger.debug(
        `Creating Client with capabilities:`,
        JSON.stringify(clientOptions.capabilities, null, 2)
      );
      this.client = new Client(this.clientInfo, clientOptions);

      this.setupRootsHandler();
      logger.debug("Roots handler registered before connect");

      try {
        await this.client.connect(transport, {
          timeout: this.timeout,
        });

        const sessionId = streamableTransport.sessionId;
        if (sessionId) {
          logger.debug(`Session ID obtained: ${sessionId}`);
        } else {
          logger.warn(
            "Session ID not available after connect - this may cause issues with SSE stream"
          );
        }
      } catch (connectErr) {
        if (connectErr instanceof Error) {
          const errMsg = connectErr.message || connectErr.toString();
          if (
            errMsg.includes("Missing session ID") ||
            errMsg.includes("Bad Request: Missing session ID") ||
            errMsg.includes("Mcp-Session-Id header is required")
          ) {
            const wrappedError = new Error(
              `Session ID error: ${errMsg}. The SDK should automatically extract session ID from initialize response.`
            );
            wrappedError.cause = connectErr;
            throw wrappedError;
          }
        }
        throw connectErr;
      }

      this.streamableTransport = streamableTransport;
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
      };

      this.connected = true;
      this.transportType = "streamable-http";
      this.setupNotificationHandler();
      this.setupSamplingHandler();
      this.setupElicitationHandler();
      logger.debug(
        `Successfully connected to MCP implementation via streamable HTTP: ${baseUrl}`
      );

      this.trackConnectorInit({
        serverUrl: this.baseUrl,
        publicIdentifier: `${this.baseUrl} (streamable-http)`,
      });
    } catch (err) {
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

  /** Get the transport type being used (streamable-http). */
  getTransportType(): "streamable-http" | null {
    return this.transportType;
  }

  protected async cleanupResources(): Promise<void> {
    if (this.streamableTransport) {
      try {
        await this.streamableTransport.terminateSession();
      } catch (e) {
        logger.debug(`Error terminating Streamable HTTP session: ${e}`);
      }
    }
    await super.cleanupResources();
  }
}
