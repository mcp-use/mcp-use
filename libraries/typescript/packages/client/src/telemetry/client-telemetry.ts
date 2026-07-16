import type { ServerConfig } from "../core/config.js";

interface ClientTelemetryTracker {
  addServer(name: string, config: ServerConfig): Promise<void> | void;
  removeServer(name: string): Promise<void> | void;
}

let tracker: ClientTelemetryTracker | undefined;

/** @internal Configures the runtime-specific client telemetry sink. */
export function setClientTelemetryTracker(
  nextTracker: ClientTelemetryTracker | undefined
): void {
  tracker = nextTracker;
}

/** @internal Records that a configured server was added. */
export function trackClientAddServer(name: string, config: ServerConfig): void {
  void tracker?.addServer(name, config);
}

/** @internal Records that a configured server was removed. */
export function trackClientRemoveServer(name: string): void {
  void tracker?.removeServer(name);
}
