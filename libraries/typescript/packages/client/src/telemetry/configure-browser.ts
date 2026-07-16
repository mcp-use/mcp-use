import { setClientTelemetryTracker } from "./client-telemetry.js";
import { setConnectorTelemetryTracker } from "./connector-telemetry.js";
import { Telemetry } from "./telemetry-browser.js";

setClientTelemetryTracker({
  addServer: (name, config) =>
    Telemetry.getInstance()
      .trackClientAddServer(name, config)
      .catch(() => undefined),
  removeServer: (name) =>
    Telemetry.getInstance()
      .trackClientRemoveServer(name)
      .catch(() => undefined),
});

setConnectorTelemetryTracker((data) =>
  Telemetry.getInstance()
    .trackConnectorInit(data)
    .catch(() => undefined)
);
