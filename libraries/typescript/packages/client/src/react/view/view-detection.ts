import { RESOURCE_MIME_TYPE } from "./ext-apps-bridge.js";

export function getViewResourceUri(
  toolMeta?: Record<string, unknown>
): string | null {
  const uri = toolMeta?.ui;
  if (
    uri &&
    typeof uri === "object" &&
    "resourceUri" in uri &&
    typeof (uri as { resourceUri?: unknown }).resourceUri === "string"
  ) {
    return (uri as { resourceUri: string }).resourceUri;
  }
  return null;
}

export function isViewTool(toolMeta?: Record<string, unknown>): boolean {
  return getViewResourceUri(toolMeta) !== null;
}

export function isViewResource(mimeType?: string): boolean {
  return mimeType === RESOURCE_MIME_TYPE;
}
