import { Tel, setTelemetrySource } from "@mcp-use/client";
import { getPackageVersion } from "./utils.js";

const LEGACY_DISABLED_KEY = "mcp_inspector_telemetry_disabled";
const LEGACY_USER_ID_KEY = "mcp_inspector_telemetry_user_id";
const OPT_OUT_KEY = "MCP_USE_ANONYMIZED_TELEMETRY";
const USER_ID_KEY = "mcp_use_user_id";

function isLocalStorageFunctional(): boolean {
  return (
    typeof localStorage !== "undefined" &&
    typeof localStorage.getItem === "function" &&
    typeof localStorage.setItem === "function"
  );
}

function migrateLegacySettings(): void {
  if (!isLocalStorageFunctional()) return;
  try {
    if (localStorage.getItem(LEGACY_DISABLED_KEY) === "true") {
      if (localStorage.getItem(OPT_OUT_KEY) !== "false") {
        localStorage.setItem(OPT_OUT_KEY, "false");
      }
    }
    if (!localStorage.getItem(USER_ID_KEY)) {
      const legacyUserId = localStorage.getItem(LEGACY_USER_ID_KEY);
      if (legacyUserId) {
        localStorage.setItem(USER_ID_KEY, legacyUserId);
      }
    }
  } catch {
    // ignore
  }
}

export function initInspectorTelemetry(): void {
  migrateLegacySettings();
  setTelemetrySource("inspector");
  Tel.getInstance().setProductVersion(getPackageVersion());
}
