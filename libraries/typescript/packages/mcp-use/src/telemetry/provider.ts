import { BaseTelemetryEvent } from "./events.js";

export interface TelemetryProvider {
  /**
   * Identify the current user (browser only)
   */
  identify?(userId: string, properties?: Record<string, any>): void;

  /**
   * Reset the user identity (browser only)
   */
  reset?(): void;

  /**
   * Capture a telemetry event
   */
  capture(event: BaseTelemetryEvent, source?: string): Promise<void>;

  /**
   * Flush pending events (node only)
   */
  flush?(): void;

  /**
   * Shutdown the provider (node only)
   */
  shutdown?(): void;
  
  /**
   * Check if telemetry is enabled
   */
  isEnabled(): boolean;
}

