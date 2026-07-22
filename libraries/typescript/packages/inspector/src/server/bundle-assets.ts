import { getInspectorVersion } from "./version.js";

/** How the Inspector is being served (telemetry + UI behavior). */
export type InspectorMode = "standalone" | "embedded" | "cloud";

export interface InspectorBundleAssetUrls {
  jsUrl: string;
  cssUrl: string;
}

/** Resolve the installed Inspector package's browser bundle URLs. */
export function resolveInspectorBundleAssetUrls(
  assetsPath: string
): InspectorBundleAssetUrls {
  const version = encodeURIComponent(getInspectorVersion());
  return {
    jsUrl: `${assetsPath}/inspector.js?v=${version}`,
    cssUrl: `${assetsPath}/inspector.css?v=${version}`,
  };
}
