import { getRuntimeEnvironment } from "./env.js";
import {
  BaseTelemetryEvent,
  ClientAddServerEvent,
  ClientRemoveServerEvent,
  ConnectorInitEvent,
  ConnectorInitEventData,
  createServerRunEventData,
  MCPAgentExecutionEvent,
  MCPAgentExecutionEventData,
  MCPClientInitEvent,
  MCPClientInitEventData,
  MCPServerTelemetryInfo,
  ServerContextEvent,
  ServerContextEventData,
  ServerInitializeEvent,
  ServerInitializeEventData,
  ServerPromptCallEvent,
  ServerPromptCallEventData,
  ServerResourceCallEvent,
  ServerResourceCallEventData,
  ServerRunEvent,
  ServerToolCallEvent,
  ServerToolCallEventData
} from "./events.js";
import { TelemetryProvider } from "./provider.js";

// No-op provider default
class NoOpTelemetryProvider implements TelemetryProvider {
  async capture(_event: BaseTelemetryEvent, _source?: string) {}
  isEnabled() { return false; }
}

/**
 * Unified Telemetry class.
 * 
 * This class is a lightweight facade. It delegates actual event capture and persistence
 * to a TelemetryProvider. This ensures that the core telemetry logic does not
 * depend on environment-specific libraries (like 'fs', 'posthog-node', 'posthog-js').
 * 
 * You must call `Tel.getInstance().use(new Provider())` at your application entry point.
 */
export class Telemetry {
  private static instance: Telemetry | null = null;
  private provider: TelemetryProvider;
  private source: string;

  private constructor() {
    this.provider = new NoOpTelemetryProvider();
    this.source = getRuntimeEnvironment();
  }

  static getInstance(): Telemetry {
    if (!Telemetry.instance) {
      Telemetry.instance = new Telemetry();
    }
    return Telemetry.instance;
  }

  /**
   * Configure the telemetry provider.
   * Call this at startup with the appropriate provider for your environment.
   */
  use(provider: TelemetryProvider): void {
    this.provider = provider;
  }

  /**
   * Set the source identifier for telemetry events.
   */
  setSource(source: string): void {
    this.source = source;
  }

  getSource(): string {
    return this.source;
  }

  get isEnabled(): boolean {
    return this.provider.isEnabled();
  }

  /**
   * Identify the current user (browser only)
   */
  identify(userId: string, properties?: Record<string, any>): void {
    if (this.provider.identify) {
      this.provider.identify(userId, properties);
    }
  }

  /**
   * Reset the user identity (browser only)
   */
  reset(): void {
    if (this.provider.reset) {
      this.provider.reset();
    }
  }

  /**
   * Flush pending events (node only)
   */
  flush(): void {
    if (this.provider.flush) {
      this.provider.flush();
    }
  }

  /**
   * Shutdown the provider (node only)
   */
  shutdown(): void {
    if (this.provider.shutdown) {
      this.provider.shutdown();
    }
  }

  // ============================================================================
  // Event Tracking Methods
  // ============================================================================

  async capture(event: BaseTelemetryEvent): Promise<void> {
    return this.provider.capture(event, this.source);
  }

  async trackAgentExecution(data: MCPAgentExecutionEventData): Promise<void> {
    if (!this.isEnabled) return;
    const event = new MCPAgentExecutionEvent(data);
    await this.capture(event);
  }

  async trackServerRunFromServer(
    server: MCPServerTelemetryInfo,
    transport: string
  ): Promise<void> {
    if (!this.isEnabled) return;
    const data = createServerRunEventData(server, transport);
    const event = new ServerRunEvent(data);
    await this.capture(event);
  }

  async trackServerInitialize(data: ServerInitializeEventData): Promise<void> {
    if (!this.isEnabled) return;
    const event = new ServerInitializeEvent(data);
    await this.capture(event);
  }

  async trackServerToolCall(data: ServerToolCallEventData): Promise<void> {
    if (!this.isEnabled) return;
    const event = new ServerToolCallEvent(data);
    await this.capture(event);
  }

  async trackServerResourceCall(data: ServerResourceCallEventData): Promise<void> {
    if (!this.isEnabled) return;
    const event = new ServerResourceCallEvent(data);
    await this.capture(event);
  }

  async trackServerPromptCall(data: ServerPromptCallEventData): Promise<void> {
    if (!this.isEnabled) return;
    const event = new ServerPromptCallEvent(data);
    await this.capture(event);
  }

  async trackServerContext(data: ServerContextEventData): Promise<void> {
    if (!this.isEnabled) return;
    const event = new ServerContextEvent(data);
    await this.capture(event);
  }

  async trackMCPClientInit(data: MCPClientInitEventData): Promise<void> {
    if (!this.isEnabled) return;
    const event = new MCPClientInitEvent(data);
    await this.capture(event);
  }

  async trackConnectorInit(data: ConnectorInitEventData): Promise<void> {
    if (!this.isEnabled) return;
    const event = new ConnectorInitEvent(data);
    await this.capture(event);
  }

  async trackClientAddServer(
    serverName: string,
    serverConfig: Record<string, any>
  ): Promise<void> {
    if (!this.isEnabled) return;
    const event = new ClientAddServerEvent({ serverName, serverConfig });
    await this.capture(event);
  }

  async trackClientRemoveServer(serverName: string): Promise<void> {
    if (!this.isEnabled) return;
    const event = new ClientRemoveServerEvent({ serverName });
    await this.capture(event);
  }

  // React Hook / Browser specific events - simplified to generic capture for now 
  // as the event classes for these might not be exported from events.ts yet.
  // The original implementation used anonymous objects passed to capture.
  
  async trackUseMcpConnection(data: {
    url: string;
    transportType: string;
    success: boolean;
    errorType?: string | null;
    connectionTimeMs?: number | null;
    hasOAuth: boolean;
    hasSampling: boolean;
    hasElicitation: boolean;
  }): Promise<void> {
    if (!this.isEnabled) return;

    // Use a generic event wrapper or custom capture logic
    // Since we can't create ad-hoc BaseTelemetryEvents easily without a class,
    // we'll rely on the provider to handle generic events if we passed raw objects,
    // but the interface expects BaseTelemetryEvent.
    // Let's create an ad-hoc event class here.
    class UseMcpConnectionEvent extends BaseTelemetryEvent {
        name = "usemcp_connection";
        get properties() {
            return {
                url_domain: new URL(data.url).hostname,
                transport_type: data.transportType,
                success: data.success,
                error_type: data.errorType ?? null,
                connection_time_ms: data.connectionTimeMs ?? null,
                has_oauth: data.hasOAuth,
                has_sampling: data.hasSampling,
                has_elicitation: data.hasElicitation,
            };
        }
    }
    await this.capture(new UseMcpConnectionEvent());
  }

  async trackUseMcpToolCall(data: {
    toolName: string;
    success: boolean;
    errorType?: string | null;
    executionTimeMs?: number | null;
  }): Promise<void> {
    if (!this.isEnabled) return;

    class UseMcpToolCallEvent extends BaseTelemetryEvent {
        name = "usemcp_tool_call";
        get properties() {
            return {
                tool_name: data.toolName,
                success: data.success,
                error_type: data.errorType ?? null,
                execution_time_ms: data.executionTimeMs ?? null,
            };
        }
    }
    await this.capture(new UseMcpToolCallEvent());
  }

  async trackUseMcpResourceRead(data: {
    resourceUri: string;
    success: boolean;
    errorType?: string | null;
  }): Promise<void> {
    if (!this.isEnabled) return;

    class UseMcpResourceReadEvent extends BaseTelemetryEvent {
        name = "usemcp_resource_read";
        get properties() {
            return {
                resource_uri_scheme: data.resourceUri.split(":")[0],
                success: data.success,
                error_type: data.errorType ?? null,
            };
        }
    }
    await this.capture(new UseMcpResourceReadEvent());
  }
}

// Aliases
export const Tel = Telemetry;

export function setTelemetrySource(source: string): void {
  Tel.getInstance().setSource(source);
}

// Export isBrowserEnvironment for compatibility
export { isBrowserEnvironment } from "./env.js";
