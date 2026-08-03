import type { ConnectorInitEventData } from "./events.js";

type ConnectorTracker = (data: ConnectorInitEventData) => Promise<void> | void;

let tracker: ConnectorTracker | undefined;

/** @internal Configures the runtime-specific connector telemetry sink. */
export function setConnectorTelemetryTracker(
  nextTracker: ConnectorTracker | undefined
): void {
  tracker = nextTracker;
}

/** @internal Sends connector telemetry when the active runtime configured it. */
export function trackConnectorTelemetry(data: ConnectorInitEventData): void {
  void tracker?.(data);
}
