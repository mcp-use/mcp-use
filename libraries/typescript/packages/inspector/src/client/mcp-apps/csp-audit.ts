import type { ViewCspMode } from "@mcp-use/client/react";
import type { WidgetDeclaredCsp } from "@/client/context/WidgetDebugContext";

function sanitizeDomain(value: string): string {
  try {
    const url = new URL(value);
    return url.origin;
  } catch {
    return value.split(/[?#]/, 1)[0];
  }
}

function sanitizeDomains(values: string[] | undefined): string[] {
  return (values ?? []).map(sanitizeDomain);
}

export function buildCspAuditRecord({
  viewId,
  mode,
  declared,
}: {
  viewId: string;
  mode: ViewCspMode;
  declared: WidgetDeclaredCsp | undefined;
}) {
  return {
    event: "mcp-apps-csp-applied",
    viewId,
    mode,
    source: mode === "permissive" ? "debug-override" : "widget-metadata",
    domains: {
      connect: sanitizeDomains(declared?.connectDomains),
      resource: sanitizeDomains(declared?.resourceDomains),
      frame: sanitizeDomains(declared?.frameDomains),
      baseUri: sanitizeDomains(declared?.baseUriDomains),
    },
  } as const;
}
