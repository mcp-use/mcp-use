import { isOAuthInteractionRequired, type Tool } from "@mcp-use/client/react";
import {
  MCPToolExecutionEvent,
  captureInspectorEvent,
} from "@/client/telemetry";
import { copyToClipboard } from "@/client/utils/browser";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ToolResult } from "./ToolResultDisplay";
import {
  clearPendingToolExecution,
  readPendingToolExecution,
  savePendingToolExecution,
  type PendingToolExecution,
} from "./tool-auth-retry";
import { mergeToolMetadata } from "./tool-metadata";

type ToolExecutionRequest = Omit<PendingToolExecution, "serverId">;

function authorizationRequiredResult(
  request: ToolExecutionRequest,
  duration = 0
): ToolResult {
  return {
    toolName: request.toolName,
    args: request.displayArgs,
    result: null,
    authorizationRequired: true,
    timestamp: request.timestamp,
    duration,
    toolMeta: request.toolMeta,
  };
}

export function useToolExecution({
  selectedTool,
  payloadToSend,
  toolArgs,
  callTool,
  readResource,
  serverId,
  isConnected,
  authenticate,
  isAuthenticating = false,
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
  isConnected: boolean;
  authenticate?: () => Promise<void>;
  isAuthenticating?: boolean;
}) {
  const [pendingAuthorization, setPendingAuthorization] =
    useState<PendingToolExecution | null>(() =>
      readPendingToolExecution(serverId)
    );
  const [results, setResults] = useState<ToolResult[]>(() =>
    pendingAuthorization
      ? [authorizationRequiredResult(pendingAuthorization)]
      : []
  );
  const [isExecuting, setIsExecuting] = useState(false);
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [authorizationError, setAuthorizationError] = useState<string | null>(
    null
  );
  const [copiedResult, setCopiedResult] = useState<number | null>(null);
  const executingRef = useRef(false);
  const activeExecutionRef = useRef<AbortController | null>(null);
  const cancelledExecutionsRef = useRef(new WeakSet<AbortController>());
  const shouldResumeAuthorizationRef = useRef(pendingAuthorization !== null);
  const [resumeVersion, setResumeVersion] = useState(0);

  const executeRequest = useCallback(
    async (request: ToolExecutionRequest) => {
      if (executingRef.current) return;

      const controller = new AbortController();
      executingRef.current = true;
      activeExecutionRef.current = controller;
      setIsExecuting(true);
      const startTime = Date.now();

      try {
        if (request.widgetResourceUri) {
          try {
            await readResource(request.widgetResourceUri);
          } catch {
            /* continue */
          }
          setResults([
            {
              toolName: request.toolName,
              args: request.args,
              result: null,
              timestamp: request.timestamp,
              duration: 0,
              toolMeta: request.toolMeta,
            },
          ]);
        }

        const result = await callTool(request.toolName, request.args, {
          timeout: 600000,
          resetTimeoutOnProgress: true,
          signal: controller.signal,
        });
        const duration = Date.now() - startTime;
        const updatedToolMeta = mergeToolMetadata(
          request.toolMeta,
          (result as any)?._meta
        );

        captureInspectorEvent(
          new MCPToolExecutionEvent({
            toolName: request.toolName,
            serverId,
            success: true,
            duration,
          })
        ).catch(() => {});
        window.dispatchEvent(new Event("mcp-tool-executed"));

        if (request.widgetResourceUri) {
          setResults((prev) =>
            prev.map((entry, index) =>
              index === 0
                ? {
                    ...entry,
                    result,
                    duration,
                    toolMeta: updatedToolMeta,
                  }
                : entry
            )
          );
        } else {
          setResults((prev) => [
            {
              toolName: request.toolName,
              args: request.displayArgs,
              result,
              timestamp: request.timestamp,
              duration,
              toolMeta: updatedToolMeta,
            },
            ...prev,
          ]);
        }
      } catch (error) {
        if (cancelledExecutionsRef.current.has(controller)) {
          return;
        }
        const duration = Date.now() - startTime;
        captureInspectorEvent(
          new MCPToolExecutionEvent({
            toolName: request.toolName,
            serverId,
            success: false,
            duration,
            error: error instanceof Error ? error.message : String(error),
          })
        ).catch(() => {});
        window.dispatchEvent(new Event("mcp-tool-executed"));

        if (isOAuthInteractionRequired(error)) {
          const pending = { ...request, serverId };
          shouldResumeAuthorizationRef.current = false;
          setPendingAuthorization(pending);
          setAuthorizationError(null);
          const authResult = authorizationRequiredResult(request, duration);
          if (request.widgetResourceUri) {
            setResults([authResult]);
          } else {
            setResults((prev) => [
              authResult,
              ...prev.filter(
                (entry) =>
                  !(
                    entry.authorizationRequired &&
                    entry.timestamp === request.timestamp
                  )
              ),
            ]);
          }
          return;
        }

        const errorResult: ToolResult = {
          toolName: request.toolName,
          args: request.displayArgs,
          result: null,
          error: error instanceof Error ? error.message : String(error),
          timestamp: request.timestamp,
          duration,
          toolMeta: request.toolMeta,
        };
        if (request.widgetResourceUri) {
          setResults([errorResult]);
        } else {
          setResults((prev) => [errorResult, ...prev]);
        }
      } finally {
        if (activeExecutionRef.current === controller) {
          activeExecutionRef.current = null;
          executingRef.current = false;
          setIsExecuting(false);
        }
      }
    },
    [callTool, readResource, serverId]
  );

  const executeTool = useCallback(async () => {
    if (!selectedTool || executingRef.current) return;

    const toolMeta = ((selectedTool as any)?._meta ||
      (selectedTool as any)?.metadata) as Record<string, unknown> | undefined;
    const widgetResourceUri = (toolMeta as any)?.ui?.resourceUri;
    await executeRequest({
      toolName: selectedTool.name,
      args: payloadToSend,
      displayArgs: toolArgs,
      timestamp: Date.now(),
      toolMeta,
      ...(typeof widgetResourceUri === "string" ? { widgetResourceUri } : {}),
    });
  }, [selectedTool, payloadToSend, toolArgs, executeRequest]);

  useEffect(() => {
    if (
      !pendingAuthorization ||
      !isConnected ||
      !shouldResumeAuthorizationRef.current ||
      executingRef.current
    ) {
      return;
    }

    shouldResumeAuthorizationRef.current = false;
    clearPendingToolExecution(serverId);
    setPendingAuthorization(null);
    setAuthorizationError(null);
    setIsAuthorizing(false);
    setResults((prev) =>
      prev.filter(
        (entry) =>
          !(
            entry.authorizationRequired &&
            entry.timestamp === pendingAuthorization.timestamp
          )
      )
    );
    void executeRequest(pendingAuthorization);
  }, [
    executeRequest,
    isConnected,
    pendingAuthorization,
    resumeVersion,
    serverId,
  ]);

  const authenticateAndRerun = useCallback(
    async (timestamp: number) => {
      if (
        !pendingAuthorization ||
        pendingAuthorization.timestamp !== timestamp ||
        !authenticate ||
        isAuthorizing
      ) {
        return;
      }

      savePendingToolExecution(pendingAuthorization);
      setAuthorizationError(null);
      setIsAuthorizing(true);
      try {
        await authenticate();
        shouldResumeAuthorizationRef.current = true;
        setResumeVersion((version) => version + 1);
      } catch (error) {
        clearPendingToolExecution(serverId);
        setAuthorizationError(
          error instanceof Error ? error.message : "Authentication failed"
        );
      } finally {
        setIsAuthorizing(false);
      }
    },
    [authenticate, isAuthorizing, pendingAuthorization, serverId]
  );

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
    const activeToolName = selectedTool?.name ?? results[0]?.toolName;
    if (!activeToolName) return [];
    return results.filter((result) => result.toolName === activeToolName);
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
    const controller = activeExecutionRef.current;
    if (!controller) return;
    cancelledExecutionsRef.current.add(controller);
    controller.abort();
    if (activeExecutionRef.current !== controller) return;
    activeExecutionRef.current = null;
    executingRef.current = false;
    setIsExecuting(false);
  }, []);

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
    pendingAuthorization,
    authenticateAndRerun,
    isAuthorizing: isAuthorizing || isAuthenticating,
    authorizationError,
  };
}
