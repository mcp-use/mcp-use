declare module "@mcp-use/evals/screenshot" {
  import type { MCPSession } from "mcp-use/client";

  export function detectToolResourceUri(
    tool: { _meta?: Record<string, unknown> } | undefined | null
  ): string | null;

  export function extractViewName(resourceUri: string): string;

  export function findChrome(): string | null;
  export function resolveChromePath(): string;
  export function timestampSuffix(date?: Date): string;

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

  export function captureToolScreenshot(
    inputs: CaptureToolScreenshotInputs,
    options: CaptureToolScreenshotOptions
  ): Promise<CaptureToolScreenshotResult>;
}
