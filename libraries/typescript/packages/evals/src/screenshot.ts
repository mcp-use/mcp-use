import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { MCPSession } from "mcp-use/client";
import { captureScreenshot } from "./screenshot/cdpScreenshot.js";
import { findChrome, resolveChromePath } from "./screenshot/chromePath.js";

export { captureScreenshot, findChrome, resolveChromePath };

export function detectToolResourceUri(
  tool: { _meta?: Record<string, unknown> } | undefined | null
): string | null {
  if (!tool) return null;
  const meta = tool._meta;
  if (!meta) return null;
  const uiMeta = (meta.ui as { resourceUri?: string } | undefined) ?? undefined;
  return (
    uiMeta?.resourceUri ??
    (meta["openai/outputTemplate"] as string | undefined) ??
    null
  );
}

export function extractViewName(resourceUri: string): string {
  const m = resourceUri.match(/^ui:\/\/([^/]+)\/(.+)$/);
  if (!m) return encodeURIComponent(resourceUri);
  const name = m[2].replace(/\.html$/, "").replace(/\.[0-9a-f]+$/i, "");
  return m[1] === "widget" ? name : `${m[1]}-${name}`;
}

export interface CaptureToolScreenshotInputs {
  session: MCPSession;
  toolName: string;
  toolArgs: Record<string, unknown>;
  toolOutput: unknown;
  resourceUri: string;
}

export interface CaptureToolScreenshotOptions {
  width?: number;
  height?: number;
  theme?: "light" | "dark";
  output?: string;
  waitFor?: string;
  delayMs?: number;
  timeoutMs?: number;
  /** Inspector host serving /inspector/preview/:view. */
  inspectorUrl: string;
  quiet?: boolean;
  cdpUrl?: string;
  deviceScaleFactor?: number;
}

export interface CaptureToolScreenshotResult {
  outputPath: string;
  width: number;
  height: number;
  view: string;
}

export async function captureToolScreenshot(
  inputs: CaptureToolScreenshotInputs,
  options: CaptureToolScreenshotOptions
): Promise<CaptureToolScreenshotResult> {
  const { width, height } = options;
  const theme: "light" | "dark" = options.theme ?? "light";
  const timeoutMs = options.timeoutMs ?? 30000;
  const delayMs = options.delayMs ?? 0;
  const chromePath = options.cdpUrl ? undefined : resolveChromePath();
  const view = extractViewName(inputs.resourceUri);
  const resourceContents = await inputs.session.readResource(inputs.resourceUri);
  const bundle = {
    resourceUri: inputs.resourceUri,
    resourceContents,
    toolInput: inputs.toolArgs,
    toolOutput: inputs.toolOutput,
  };

  const previewUrl = new URL(`/inspector/preview/${view}`, options.inspectorUrl);
  previewUrl.searchParams.set("theme", theme);
  if (width !== undefined) {
    previewUrl.searchParams.set("width", String(width));
  }

  const outputPath = path.resolve(options.output ?? `./${view}-${timestampSuffix()}.png`);
  await mkdir(path.dirname(outputPath), { recursive: true });

  const captured = await captureScreenshot({
    url: previewUrl.toString(),
    width,
    height,
    theme,
    waitForSelector: options.waitFor ?? 'body[data-view-ready="true"]',
    timeoutMs,
    outputPath,
    chromePath,
    cdpUrl: options.cdpUrl,
    delayMs: Number.isFinite(delayMs) && delayMs > 0 ? delayMs : 0,
    bundle,
    deviceScaleFactor: options.deviceScaleFactor,
  });

  return {
    outputPath,
    width: captured.width,
    height: captured.height,
    view,
  };
}

export function timestampSuffix(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const datePart = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const timePart = `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  return `${datePart}_${timePart}`;
}
