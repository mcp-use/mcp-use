import { getInspectorVersion } from "./version.js";

/** How the inspector is being served (telemetry + hosted UI behavior). */
export type InspectorMode = "standalone" | "embedded" | "cloud";

/** npm dist-tag for remote inspector bundles (matches mcp-use server). */
export const JSDELIVR_INSPECTOR_TAG = "beta";

export const DEFAULT_REMOTE_ASSETS_URL = `https://cdn.jsdelivr.net/npm/@mcp-use/inspector@${JSDELIVR_INSPECTOR_TAG}/dist/cdn/inspector.js`;

/** Derive the stylesheet URL from a bundle script URL. */
export function inspectorStylesUrl(assetsUrl: string): string {
  return assetsUrl.replace(/\.js(?=$|[?#])/, ".css");
}

export type InspectorAssetUrls = {
  jsUrl: string;
  cssUrl: string;
  useLocal: boolean;
  resolveLatest: boolean;
};

export function resolveInspectorAssetUrls(
  inspectorMode: InspectorMode | undefined,
  basePath: string
): InspectorAssetUrls {
  const envUrl =
    process.env.INSPECTOR_ASSETS_URL ??
    process.env.MCP_USE_INSPECTOR_ASSETS_URL;
  if (envUrl) {
    return {
      jsUrl: envUrl,
      cssUrl: inspectorStylesUrl(envUrl),
      useLocal: false,
      resolveLatest: false,
    };
  }

  // ponytail: deprecated — INSPECTOR_CDN_BASE was a host base with versioned paths
  const legacyBase = process.env.INSPECTOR_CDN_BASE;
  if (legacyBase) {
    const base = legacyBase.replace(/\/$/, "");
    if (/\.js(?:$|[?#])/.test(base)) {
      return {
        jsUrl: base,
        cssUrl: inspectorStylesUrl(base),
        useLocal: false,
        resolveLatest: false,
      };
    }
    return {
      jsUrl: `${base}/inspector.js`,
      cssUrl: `${base}/inspector.css`,
      useLocal: false,
      resolveLatest: false,
    };
  }

  if (inspectorMode === "standalone") {
    const prefix = basePath;
    const version = encodeURIComponent(getInspectorVersion());
    return {
      jsUrl: `${prefix}/dist/cdn/inspector.js?v=${version}`,
      cssUrl: `${prefix}/dist/cdn/inspector.css?v=${version}`,
      useLocal: true,
      resolveLatest: false,
    };
  }

  const jsUrl = DEFAULT_REMOTE_ASSETS_URL;
  return {
    jsUrl,
    cssUrl: inspectorStylesUrl(jsUrl),
    useLocal: false,
    resolveLatest: true,
  };
}
