import type { WidgetDeclaredCsp } from "@/client/context/WidgetDebugContext";

export function buildCSPString(csp: WidgetDeclaredCsp): string {
  const sanitize = (d: string) => d.replace(/['"<>;]/g, "").trim();
  const connectDomains = (csp.connectDomains || [])
    .map(sanitize)
    .filter(Boolean);
  const resourceDomains = (csp.resourceDomains || [])
    .map(sanitize)
    .filter(Boolean);
  const frameDomains = (csp.frameDomains || []).map(sanitize).filter(Boolean);
  const baseUriDomains = (csp.baseUriDomains || [])
    .map(sanitize)
    .filter(Boolean);

  const connectSrc =
    connectDomains.length > 0 ? connectDomains.join(" ") : "'none'";
  const resourceSrc =
    resourceDomains.length > 0
      ? ["data:", "blob:", ...resourceDomains].join(" ")
      : "data: blob:";
  const frameSrc = frameDomains.length > 0 ? frameDomains.join(" ") : "'none'";
  const baseUri =
    baseUriDomains.length > 0 ? baseUriDomains.join(" ") : "'none'";

  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${resourceSrc}`,
    `style-src 'unsafe-inline' ${resourceSrc}`,
    `img-src ${resourceSrc}`,
    `font-src ${resourceSrc}`,
    `media-src ${resourceSrc}`,
    `connect-src ${connectSrc}`,
    `frame-src ${frameSrc}`,
    "object-src 'none'",
    `base-uri ${baseUri}`,
  ].join("; ");
}

export function parseCustomProps(
  customProps?: Record<string, string>
): Record<string, unknown> {
  const parsed: Record<string, unknown> = {};
  if (!customProps) return parsed;
  for (const [k, v] of Object.entries(customProps)) {
    if (
      typeof v === "string" &&
      (v.trim().startsWith("[") || v.trim().startsWith("{"))
    ) {
      try {
        parsed[k] = JSON.parse(v);
      } catch {
        parsed[k] = v;
      }
    } else {
      parsed[k] = v;
    }
  }
  return parsed;
}
