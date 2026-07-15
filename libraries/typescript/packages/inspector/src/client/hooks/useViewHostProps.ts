import type {
  ResolvedViewResource,
  ViewConnection,
  ViewCspMode,
  ViewDisplayMode,
  ViewRendererProps,
} from "@mcp-use/client/react";
import { useMcpClient } from "@mcp-use/client/react";
import type { Tool } from "@modelcontextprotocol/client";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { consoleLogBus } from "@/client/console-log-bus";
import { buildCSPString } from "@/client/mcp-apps/csp";
import { wrapTransportWithLogging } from "@/client/mcp-apps/logging-transport";
import { useTheme } from "@/client/context/ThemeContext";
import { useWidgetDebug } from "@/client/context/WidgetDebugContext";
import { useDeviceViewport } from "@/client/hooks/useDeviceViewport";
import { useMcpAppsHostContext } from "@/client/hooks/useMcpAppsHostContext";

const HOST_INFO = { name: "mcp-use-inspector", version: "11.0.0" } as const;

function useStableViewConnection(
  server: ReturnType<typeof useMcpClient>["servers"][number] | undefined,
  readResource: (uri: string) => Promise<unknown>
): ViewConnection | null {
  const serverRef = useRef(server);
  serverRef.current = server;
  const readResourceRef = useRef(readResource);
  readResourceRef.current = readResource;

  return useMemo(() => {
    if (!server) return null;
    return {
      callTool: (name, args, opts) =>
        serverRef.current!.callTool(name, args ?? {}, opts),
      readResource: (uri) => readResourceRef.current(uri),
      get resources() {
        return serverRef.current?.resources;
      },
    };
  }, [server?.id]);
}

export function useViewHostProps(options: {
  serverId: string;
  viewId: string;
  resourceUri: string;
  toolName: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: unknown;
  toolMetadata?: Record<string, unknown>;
  tool?: Tool;
  readResource: (uri: string) => Promise<unknown>;
  displayMode?: ViewDisplayMode;
  onDisplayModeChange?: (mode: ViewDisplayMode) => void;
  inlineMaxWidth?: number;
  chromeless?: boolean;
  onReady?: () => void;
}): Pick<
  ViewRendererProps,
  | "source"
  | "hostInfo"
  | "hostContext"
  | "cspMode"
  | "wrapTransport"
  | "onCspViolation"
  | "onModelContextUpdate"
  | "onLog"
  | "onResourceResolved"
  | "displayMode"
  | "onDisplayModeChange"
  | "inlineMaxWidth"
  | "chromeless"
  | "onReady"
> | null {
  const {
    serverId,
    viewId,
    resourceUri,
    toolName,
    toolInput,
    toolOutput,
    toolMetadata,
    tool,
    readResource,
    displayMode,
    onDisplayModeChange,
    inlineMaxWidth,
    chromeless,
    onReady,
  } = options;

  const { resolvedTheme } = useTheme();
  const { servers } = useMcpClient();
  const server = servers.find((s) => s.id === serverId);
  const {
    playground,
    addWidget,
    removeWidget,
    addCspViolation,
    setWidgetModelContext,
    setWidgetDeclaredCsp,
  } = useWidgetDebug();

  const cspMode: ViewCspMode =
    playground.cspMode === "permissive" ? "permissive" : "widget-declared";
  const { maxWidth, maxHeight } = useDeviceViewport(
    playground.deviceType,
    playground.customViewport
  );

  const hostContext = useMcpAppsHostContext({
    theme: resolvedTheme,
    displayMode: displayMode ?? "inline",
    maxWidth,
    maxHeight,
    playground,
    deviceType: playground.deviceType,
    toolCallId: viewId,
    toolName,
    toolInput,
    toolOutput,
    toolMetadata,
    tool,
  });

  const hostContextRef = useRef(hostContext);
  hostContextRef.current = hostContext;

  const connection = useStableViewConnection(server, readResource);

  const source = useMemo(
    () =>
      connection
        ? ({
            kind: "live" as const,
            connection,
            resourceUri,
          } satisfies ViewRendererProps["source"])
        : null,
    [connection, resourceUri]
  );

  const wrapTransport = useCallback(
    (transport: Parameters<NonNullable<ViewRendererProps["wrapTransport"]>>[0]) =>
      wrapTransportWithLogging(transport, viewId),
    [viewId]
  );

  const onResourceResolved = useCallback(
    (resolved: ResolvedViewResource) => {
      addWidget(viewId, {
        toolName,
        protocol: "mcp-apps",
        hostContext: hostContextRef.current,
      });

      const declared = resolved.declaredCsp;
      let effectivePolicy: string | undefined;
      if (cspMode === "permissive") {
        effectivePolicy = [
          "default-src * 'unsafe-inline' 'unsafe-eval' data: blob: filesystem: about:",
          "script-src * 'unsafe-inline' 'unsafe-eval' data: blob:",
          "style-src * 'unsafe-inline' data: blob:",
          "img-src * data: blob: https: http:",
          "media-src * data: blob: https: http:",
          "font-src * data: blob: https: http:",
          "connect-src * data: blob: https: http: ws: wss: about:",
          "frame-src * data: blob: https: http: about:",
          "object-src * data: blob:",
          "base-uri *",
          "form-action *",
        ].join("; ");
      } else if (declared) {
        effectivePolicy = buildCSPString(declared);
      }
      setWidgetDeclaredCsp(viewId, declared, effectivePolicy);
    },
    [addWidget, viewId, toolName, cspMode, setWidgetDeclaredCsp]
  );

  useEffect(() => {
    return () => removeWidget(viewId);
  }, [viewId, removeWidget]);

  const onCspViolation = useCallback(
    (violation: Parameters<NonNullable<ViewRendererProps["onCspViolation"]>>[0]) => {
      addCspViolation(viewId, {
        directive: violation.directive,
        effectiveDirective:
          violation.effectiveDirective ?? violation.directive,
        blockedUri: violation.blockedUri,
        sourceFile: violation.sourceFile ?? undefined,
        lineNumber: violation.lineNumber ?? undefined,
        columnNumber: violation.columnNumber ?? undefined,
        originalPolicy: violation.originalPolicy,
        timestamp: violation.timestamp,
      });
    },
    [addCspViolation, viewId]
  );

  const onModelContextUpdate = useCallback(
    ({
      content,
      structuredContent,
    }: Parameters<NonNullable<ViewRendererProps["onModelContextUpdate"]>>[0]) => {
      setWidgetModelContext(viewId, {
        content: content as any[] | undefined,
        structuredContent: structuredContent as
          | Record<string, unknown>
          | undefined,
      });
      try {
        localStorage.setItem(
          `mcp-use:widget-state:${viewId}`,
          JSON.stringify(structuredContent)
        );
      } catch {
        // ignore quota errors
      }
    },
    [setWidgetModelContext, viewId]
  );

  const onLog = useCallback(
    ({ level, data }: Parameters<NonNullable<ViewRendererProps["onLog"]>>[0]) => {
      const mappedLevel =
        level === "warning" ? "warn" : level === "error" ? "error" : "log";
      consoleLogBus.publish({
        level: mappedLevel as "debug" | "info" | "warn" | "error" | "log",
        args: Array.isArray(data) ? data : [data],
        timestamp: new Date().toISOString(),
        url: resourceUri,
      });
    },
    [resourceUri]
  );

  if (!source) return null;

  return {
    source,
    hostInfo: HOST_INFO,
    hostContext,
    cspMode,
    wrapTransport,
    onCspViolation,
    onModelContextUpdate,
    onLog,
    onResourceResolved,
    displayMode,
    onDisplayModeChange,
    inlineMaxWidth,
    chromeless,
    onReady,
  };
}
