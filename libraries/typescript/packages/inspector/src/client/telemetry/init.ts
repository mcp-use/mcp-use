import {
  Tel,
  setTelemetrySource,
  captureScarf,
  SCARF_GATEWAY_URL,
} from "@mcp-use/client";
import { getPackageVersion } from "./utils.js";

const LEGACY_DISABLED_KEY = "mcp_inspector_telemetry_disabled";
const LEGACY_USER_ID_KEY = "mcp_inspector_telemetry_user_id";
const DOWNLOAD_VERSION_KEY = "mcp_inspector_telemetry_download_version";
const OPT_OUT_KEY = "MCP_USE_ANONYMIZED_TELEMETRY";
const USER_ID_KEY = "mcp_use_user_id";

type InspectorMode = "standalone" | "embedded" | "cloud";

function isLocalStorageFunctional(): boolean {
  return (
    typeof localStorage !== "undefined" &&
    typeof localStorage.getItem === "function" &&
    typeof localStorage.setItem === "function"
  );
}

function detectInspectorMode(): InspectorMode {
  if (typeof window === "undefined") return "standalone";
  const injected = (window as unknown as { __MCP_INSPECTOR_MODE__?: string })
    .__MCP_INSPECTOR_MODE__;
  if (
    injected === "standalone" ||
    injected === "embedded" ||
    injected === "cloud"
  ) {
    return injected;
  }
  return "standalone";
}

/** ponytail: numeric semver segments only; upgrade to full semver lib if pre-release ordering matters */
function isVersionGreater(a: string, b: string): boolean {
  const parse = (v: string) =>
    v
      .split("-")[0]
      .split(".")
      .map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da > db;
  }
  return false;
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

async function trackInspectorPackageDownload(): Promise<void> {
  if (typeof window === "undefined" || !isLocalStorageFunctional()) return;

  try {
    const tel = Tel.getInstance();
    if (!tel.isEnabled) return;

    const currentVersion = getPackageVersion();
    let shouldTrack = false;
    let firstDownload = false;

    const storedVersion = localStorage.getItem(DOWNLOAD_VERSION_KEY);

    if (!storedVersion) {
      shouldTrack = true;
      firstDownload = true;
      localStorage.setItem(DOWNLOAD_VERSION_KEY, currentVersion);
    } else if (isVersionGreater(currentVersion, storedVersion)) {
      shouldTrack = true;
      localStorage.setItem(DOWNLOAD_VERSION_KEY, currentVersion);
    }

    if (!shouldTrack) return;

    void captureScarf(
      {
        triggered_by: "initialization",
        mcp_use_version: currentVersion,
        user_id: tel.userId,
        event: "package_download",
        first_download: firstDownload,
        language: "typescript",
        source: "inspector",
        package: "inspector",
        mode: detectInspectorMode(),
      },
      SCARF_GATEWAY_URL
    );
  } catch {
    // Silently fail - telemetry should not break the application
  }
}

export function initInspectorTelemetry(): void {
  migrateLegacySettings();
  setTelemetrySource("inspector");
  Tel.getInstance().setProductVersion(getPackageVersion());
  void trackInspectorPackageDownload();
}
