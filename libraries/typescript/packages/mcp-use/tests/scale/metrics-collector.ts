/**
 * Metrics Collection for MCP Server Scale Tests
 *
 * Provides Prometheus-compatible metrics and real-time monitoring.
 *
 * Usage:
 *   const collector = new MCPMetricsCollector();
 *   collector.startMonitoring(server, streamManager, 5000); // Every 5s
 *
 *   // Expose metrics endpoint
 *   app.get('/metrics', async (req, res) => {
 *     res.set('Content-Type', register.contentType);
 *     res.end(await collector.getMetrics());
 *   });
 */

import { register, Counter, Histogram, Gauge, Summary } from "prom-client";

export class MCPMetricsCollector {
  // Counters - monotonically increasing
  private toolCallsTotal = new Counter({
    name: "mcp_tool_calls_total",
    help: "Total number of tool calls",
    labelNames: ["tool_name", "status"],
  });

  private resourceReadsTotal = new Counter({
    name: "mcp_resource_reads_total",
    help: "Total number of resource reads",
    labelNames: ["uri", "status"],
  });

  private promptsTotal = new Counter({
    name: "mcp_prompts_total",
    help: "Total number of prompt requests",
    labelNames: ["prompt_name", "status"],
  });

  private notificationsSent = new Counter({
    name: "mcp_notifications_sent_total",
    help: "Total notifications sent",
    labelNames: ["notification_type"],
  });

  private sessionsCreated = new Counter({
    name: "mcp_sessions_created_total",
    help: "Total number of sessions created",
  });

  private sessionsClosed = new Counter({
    name: "mcp_sessions_closed_total",
    help: "Total number of sessions closed",
    labelNames: ["reason"], // 'client_request', 'timeout', 'error'
  });

  private errorsTotal = new Counter({
    name: "mcp_errors_total",
    help: "Total errors encountered",
    labelNames: ["error_type", "operation"],
  });

  // Histograms - latency distributions
  private requestDuration = new Histogram({
    name: "mcp_request_duration_seconds",
    help: "Request latency in seconds",
    labelNames: ["method"],
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  });

  private toolCallDuration = new Histogram({
    name: "mcp_tool_call_duration_seconds",
    help: "Tool call latency in seconds",
    labelNames: ["tool_name"],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
  });

  private notificationLatency = new Histogram({
    name: "mcp_notification_latency_seconds",
    help: "Notification delivery latency",
    buckets: [0.001, 0.01, 0.05, 0.1, 0.5, 1],
  });

  // Gauges - current values
  private activeSessions = new Gauge({
    name: "mcp_active_sessions",
    help: "Number of active sessions",
  });

  private activeStreams = new Gauge({
    name: "mcp_active_sse_streams",
    help: "Number of active SSE streams",
  });

  private memoryUsage = new Gauge({
    name: "mcp_memory_usage_bytes",
    help: "Memory usage in bytes",
    labelNames: ["type"], // 'heap_used', 'heap_total', 'external', 'rss'
  });

  private redisConnections = new Gauge({
    name: "mcp_redis_connections",
    help: "Number of Redis connections",
  });

  // Summary - statistical distributions
  private sessionDuration = new Summary({
    name: "mcp_session_duration_seconds",
    help: "Session duration in seconds",
    percentiles: [0.5, 0.9, 0.95, 0.99],
  });

  private monitoringInterval: NodeJS.Timeout | null = null;

  /**
   * Start automatic metrics collection
   */
  startMonitoring(
    server: any,
    streamManager: any,
    intervalMs: number = 5000
  ): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    this.monitoringInterval = setInterval(async () => {
      await this.collectSystemMetrics(server, streamManager);
    }, intervalMs);

    console.log(`[Metrics] Started monitoring (interval: ${intervalMs}ms)`);
  }

  /**
   * Stop automatic metrics collection
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }

  /**
   * Collect system-level metrics
   */
  private async collectSystemMetrics(
    server: any,
    streamManager: any
  ): Promise<void> {
    try {
      // Session metrics
      const activeSessions = server.getActiveSessions?.() || [];
      this.activeSessions.set(activeSessions.length);

      // Stream metrics
      if (streamManager?.localSize !== undefined) {
        this.activeStreams.set(streamManager.localSize);
      }

      // Memory metrics
      const mem = process.memoryUsage();
      this.memoryUsage.set({ type: "heap_used" }, mem.heapUsed);
      this.memoryUsage.set({ type: "heap_total" }, mem.heapTotal);
      this.memoryUsage.set({ type: "external" }, mem.external);
      this.memoryUsage.set({ type: "rss" }, mem.rss);
    } catch (error) {
      console.error("[Metrics] Error collecting system metrics:", error);
    }
  }

  /**
   * Record a tool call
   */
  recordToolCall(toolName: string, durationMs: number, success: boolean): void {
    this.toolCallsTotal.inc({
      tool_name: toolName,
      status: success ? "success" : "error",
    });

    this.toolCallDuration.observe({ tool_name: toolName }, durationMs / 1000);
    this.requestDuration.observe({ method: "tools/call" }, durationMs / 1000);
  }

  /**
   * Record a resource read
   */
  recordResourceRead(uri: string, durationMs: number, success: boolean): void {
    this.resourceReadsTotal.inc({
      uri,
      status: success ? "success" : "error",
    });

    this.requestDuration.observe(
      { method: "resources/read" },
      durationMs / 1000
    );
  }

  /**
   * Record a prompt request
   */
  recordPrompt(promptName: string, durationMs: number, success: boolean): void {
    this.promptsTotal.inc({
      prompt_name: promptName,
      status: success ? "success" : "error",
    });

    this.requestDuration.observe({ method: "prompts/get" }, durationMs / 1000);
  }

  /**
   * Record a notification sent
   */
  recordNotification(type: string, latencyMs?: number): void {
    this.notificationsSent.inc({ notification_type: type });

    if (latencyMs !== undefined) {
      this.notificationLatency.observe(latencyMs / 1000);
    }
  }

  /**
   * Record session creation
   */
  recordSessionCreated(): void {
    this.sessionsCreated.inc();
  }

  /**
   * Record session closure
   */
  recordSessionClosed(
    reason: "client_request" | "timeout" | "error",
    durationMs: number
  ): void {
    this.sessionsClosed.inc({ reason });
    this.sessionDuration.observe(durationMs / 1000);
  }

  /**
   * Record an error
   */
  recordError(errorType: string, operation: string): void {
    this.errorsTotal.inc({ error_type: errorType, operation });
  }

  /**
   * Get Prometheus-formatted metrics
   */
  async getMetrics(): Promise<string> {
    return await register.metrics();
  }

  /**
   * Get current metrics as JSON
   */
  async getMetricsJSON(): Promise<any> {
    const metrics = await register.getMetricsAsJSON();
    return metrics;
  }

  /**
   * Reset all metrics (useful for testing)
   */
  reset(): void {
    register.clear();
  }

  /**
   * Generate a human-readable summary
   */
  async getSummary(): Promise<string> {
    const metrics = await this.getMetricsJSON();

    const summary: string[] = [
      "╔════════════════════════════════════════════════════════════╗",
      "║              MCP Server Metrics Summary                    ║",
      "╠════════════════════════════════════════════════════════════╣",
    ];

    // Find metrics by name
    const findMetric = (name: string) =>
      metrics.find((m: any) => m.name === name);

    const toolCalls = findMetric("mcp_tool_calls_total");
    const resourceReads = findMetric("mcp_resource_reads_total");
    const notifications = findMetric("mcp_notifications_sent_total");
    const activeSessions = findMetric("mcp_active_sessions");
    const errors = findMetric("mcp_errors_total");

    if (toolCalls) {
      const total = toolCalls.values.reduce(
        (sum: number, v: any) => sum + v.value,
        0
      );
      summary.push(
        `║  Tool Calls: ${total.toString().padStart(10)}                                      ║`
      );
    }

    if (resourceReads) {
      const total = resourceReads.values.reduce(
        (sum: number, v: any) => sum + v.value,
        0
      );
      summary.push(
        `║  Resource Reads: ${total.toString().padStart(6)}                                  ║`
      );
    }

    if (notifications) {
      const total = notifications.values.reduce(
        (sum: number, v: any) => sum + v.value,
        0
      );
      summary.push(
        `║  Notifications: ${total.toString().padStart(7)}                                   ║`
      );
    }

    if (activeSessions) {
      const value = activeSessions.values[0]?.value || 0;
      summary.push(
        `║  Active Sessions: ${value.toString().padStart(5)}                                  ║`
      );
    }

    if (errors) {
      const total = errors.values.reduce(
        (sum: number, v: any) => sum + v.value,
        0
      );
      summary.push(
        `║  Errors: ${total.toString().padStart(12)}                                         ║`
      );
    }

    summary.push(
      "╚════════════════════════════════════════════════════════════╝"
    );

    return summary.join("\n");
  }
}

// Singleton instance
let instance: MCPMetricsCollector | null = null;

export function getMetricsCollector(): MCPMetricsCollector {
  if (!instance) {
    instance = new MCPMetricsCollector();
  }
  return instance;
}
