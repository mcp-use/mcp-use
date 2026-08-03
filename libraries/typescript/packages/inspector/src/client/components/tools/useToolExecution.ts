import type { Tool } from "@mcp-use/client/react";
import {
  MCPToolExecutionEvent,
  captureInspectorEvent,
} from "@/client/telemetry";
import { copyToClipboard } from "@/client/utils/browser";
import { useCallback, useMemo, useState } from "react";
import type { ToolResult } from "./ToolResultDisplay";
import { mergeToolMetadata } from "./tool-metadata";

export function useToolExecution({
  selectedTool,
  payloadToSend,
  toolArgs,
  callTool,
  readResource,
  serverId,
}: {
  selectedTool: Tool | null;
  payloadToSend: Record<string, unknown>;
  toolArgs: Record<string, unknown>;
  callTool: (
    name: string,
    args: Record<string, unknown>,
    options?: {
      timeout?: number;
      resetTimeoutOnProgress?: boolean;
      signal?: AbortSignal;
    }
  ) => Promise<unknown>;
  readResource: (uri: string) => Promise<unknown>;
  serverId: string;
}) {
  const [results, setResults] = useState<ToolResult[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [copiedResult, setCopiedResult] = useState<number | null>(null);
  const [abortController, setAbortController] =
    useState<AbortController | null>(null);

  const executeTool = useCallback(async () => {
    if (!selectedTool || isExecuting) return;

    const controller = new AbortController();
    setAbortController(controller);
    setIsExecuting(true);
    const startTime = Date.now();

    try {
      const parsedArgs = payloadToSend;
      const toolMeta =
        (selectedTool as any)?._meta || (selectedTool as any)?.metadata;
      const mcpAppsResourceUri = toolMeta?.ui?.resourceUri;
      const widgetResourceUri = mcpAppsResourceUri;

      if (widgetResourceUri && typeof widgetResourceUri === "string") {
        try {
          await readResource(widgetResourceUri);
        } catch {
          /* continue */
        }
        setResults([
          {
            toolName: selectedTool.name,
            args: parsedArgs,
            result: null,
            timestamp: startTime,
            duration: 0,
            toolMeta,
          },
        ]);
      }

      const result = await callTool(selectedTool.name, parsedArgs, {
        timeout: 600000,
        resetTimeoutOnProgress: true,
        signal: controller.signal,
      });
      const duration = Date.now() - startTime;
      const updatedToolMeta = mergeToolMetadata(
        toolMeta,
        (result as any)?._meta
      );

      captureInspectorEvent(
        new MCPToolExecutionEvent({
          toolName: selectedTool.name,
          serverId,
          success: true,
          duration,
        })
      ).catch(() => {});
      window.dispatchEvent(new Event("mcp-tool-executed"));

      if (widgetResourceUri && typeof widgetResourceUri === "string") {
        setResults((prev) =>
          prev.map((r, idx) =>
            idx === 0
              ? { ...r, result, duration, toolMeta: updatedToolMeta }
              : r
          )
        );
      } else {
        setResults((prev) => [
          {
            toolName: selectedTool.name,
            args: toolArgs,
            result,
            timestamp: startTime,
            duration,
            toolMeta: updatedToolMeta,
          },
          ...prev,
        ]);
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      captureInspectorEvent(
        new MCPToolExecutionEvent({
          toolName: selectedTool.name,
          serverId,
          success: false,
          duration,
          error: error instanceof Error ? error.message : String(error),
        })
      ).catch(() => {});
      window.dispatchEvent(new Event("mcp-tool-executed"));

      const toolMeta =
        (selectedTool as any)?._meta || (selectedTool as any)?.metadata;
      const errorResult: ToolResult = {
        toolName: selectedTool.name,
        args: toolArgs,
        result: null,
        error: error instanceof Error ? error.message : String(error),
        timestamp: startTime,
        duration,
        toolMeta,
      };
      const hasWidgetResource = toolMeta?.ui?.resourceUri;
      if (hasWidgetResource) {
        setResults([errorResult]);
      } else {
        setResults((prev) => [errorResult, ...prev]);
      }
    } finally {
      setIsExecuting(false);
    }
  }, [
    selectedTool,
    payloadToSend,
    toolArgs,
    isExecuting,
    callTool,
    readResource,
    serverId,
  ]);

  const handleCopyResult = useCallback(async (index: number, text: string) => {
    try {
      await copyToClipboard(text);
      setCopiedResult(index);
      setTimeout(() => setCopiedResult(null), 2000);
    } catch (error) {
      console.error("[ToolsTab] Failed to copy result:", error);
    }
  }, []);

  const handleDeleteResult = useCallback((index: number) => {
    setResults((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const filteredResults = useMemo(() => {
    if (!selectedTool) return [];
    return results.filter((r) => r.toolName === selectedTool.name);
  }, [results, selectedTool]);

  const handleFullscreen = useCallback(
    (index: number) => {
      const result = filteredResults[index];
      if (!result) return;
      const newWindow = window.open("", "_blank", "width=800,height=600");
      if (newWindow) {
        newWindow.document.write(`
            <html>
              <head><title>${result.toolName} Result</title></head>
              <body><pre>${JSON.stringify(result.result, null, 2)}</pre></body>
            </html>
          `);
        newWindow.document.close();
      }
    },
    [filteredResults]
  );

  const cancelExecution = useCallback(() => {
    abortController?.abort();
    setAbortController(null);
    setIsExecuting(false);
  }, [abortController]);

  return {
    results,
    setResults,
    isExecuting,
    copiedResult,
    executeTool,
    handleCopyResult,
    handleDeleteResult,
    handleFullscreen,
    filteredResults,
    cancelExecution,
  };
}
