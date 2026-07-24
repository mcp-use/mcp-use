import type {
  ResolvedViewResource,
  ViewConnection,
  ViewCspMode,
  ViewDisplayMode,
  ViewRendererProps,
} from "@mcp-use/client/react";
import { buildViewSandboxUrl, useMcpClient } from "@mcp-use/client/react";
import type { Tool } from "@mcp-use/client/react";
import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { consoleLogBus } from "@/client/console-log-bus";
import { Button } from "@/client/components/ui/button";
import { buildCSPString } from "@/client/mcp-apps/csp";
import { wrapTransportWithLogging } from "@/client/mcp-apps/logging-transport";
import { useTheme } from "@/client/context/ThemeContext";
import { useWidgetDebug } from "@/client/context/WidgetDebugContext";
import { useDeviceViewport } from "@/client/hooks/useDeviceViewport";
import { useMcpAppsHostContext } from "@/client/hooks/useMcpAppsHostContext";
import { useMcpAppsHostActions } from "@/client/hooks/useMcpAppsHostActions";
import { buildCspAuditRecord } from "@/client/mcp-apps/csp-audit";
import { getPackageVersion } from "@/client/telemetry/utils";
import { getServerDisplayName, getServerIconUrl } from "@/client/utils/servers";
import {
  normalizeWidgetModelContext,
  serializeWidgetModelContexts,
} from "@/client/components/chat/widget-model-context";
import { getInspectorBase } from "@/client/utils/basePath";
import type { LLMConfig } from "@/client/components/chat/types";
import { debugMcpApps } from "@/client/mcp-apps/debug";

const HOST_INFO = {
  name: "mcp-use-inspector",
  version: getPackageVersion(),
} as const;
const CHAT_MODEL_CONTEXT_CAPABILITIES = {
  text: {},
  structuredContent: {},
} as const;

interface InspectorSandboxWindow extends Window {
  __MCP_SANDBOX_ORIGIN__?: string;
}

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
      get tools() {
        return serverRef.current?.tools;
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
  modelContextScope?: string;
  llmConfig?: LLMConfig | null;
  onReady?: () => void;
}): Pick<
  ViewRendererProps,
  | "source"
  | "hostInfo"
  | "hostContext"
  | "sandboxUrl"
  | "cspMode"
  | "wrapTransport"
  | "onCspViolation"
  | "onModelContextUpdate"
  | "onSamplingRequest"
  | "onDownloadFile"
  | "onAppToolsChanged"
  | "modelContextCapabilities"
  | "onLog"
  | "onResourceResolved"
  | "displayMode"
  | "onDisplayModeChange"
  | "inlineMaxWidth"
  | "chromeless"
  | "onReady"
  | "mockOpenAiFileApis"
  | "fullscreenHeader"
  | "renderFullscreenClose"
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
    modelContextScope,
    llmConfig,
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
    getModelContexts,
    setWidgetAppToolConnection,
  } = useWidgetDebug();
  const { onSamplingRequest, onDownloadFile } =
    useMcpAppsHostActions(llmConfig);

  const cspMode: ViewCspMode =
    playground.cspMode === "permissive" ? "permissive" : "widget-declared";
  const { maxWidth, maxHeight } = useDeviceViewport(playground.deviceType);

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

  const sandboxUrl = useMemo(() => {
    if (typeof window === "undefined") return undefined;
    const origin = (window as InspectorSandboxWindow).__MCP_SANDBOX_ORIGIN__;
    if (!origin) return undefined;
    try {
      const documentUrl = new URL(`${getInspectorBase()}/sandbox`, origin);
      return (resolved: ResolvedViewResource) =>
        buildViewSandboxUrl(documentUrl, {
          cspMode,
          permissions: resolved.permissions,
          widgetCsp: resolved.declaredCsp,
        });
    } catch {
      return undefined;
    }
  }, [cspMode]);

  const wrapTransport = useCallback(
    (
      transport: Parameters<NonNullable<ViewRendererProps["wrapTransport"]>>[0]
    ) => wrapTransportWithLogging(transport, serverId, viewId),
    [serverId, viewId]
  );

  const onResourceResolved = useCallback(
    (resolved: ResolvedViewResource) => {
      addWidget(viewId, {
        toolName,
        protocol: "mcp-apps",
        modelContextScope,
        hostContext: hostContextRef.current,
      });

      const declared = resolved.declaredCsp;
      const auditRecord = buildCspAuditRecord({
        viewId,
        mode: cspMode,
        declared,
      });
      console.info("[MCP Apps CSP]", auditRecord);
      consoleLogBus.publish({
        level: "info",
        args: ["[MCP Apps CSP]", auditRecord],
        timestamp: new Date().toISOString(),
      });
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
    [
      addWidget,
      viewId,
      toolName,
      modelContextScope,
      cspMode,
      setWidgetDeclaredCsp,
    ]
  );

  useEffect(() => {
    return () => removeWidget(viewId);
  }, [viewId, removeWidget]);

  const onCspViolation = useCallback(
    (
      violation: Parameters<NonNullable<ViewRendererProps["onCspViolation"]>>[0]
    ) => {
      addCspViolation(viewId, {
        directive: violation.directive,
        effectiveDirective: violation.effectiveDirective ?? violation.directive,
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

  const handleModelContextUpdate = useCallback(
    ({
      content,
      structuredContent,
    }: Parameters<
      NonNullable<ViewRendererProps["onModelContextUpdate"]>
    >[0]) => {
      if (!modelContextScope) {
        throw new Error(
          "This host surface does not support model context updates"
        );
      }
      const normalized = normalizeWidgetModelContext({
        content,
        structuredContent,
      });
      const nextContexts = getModelContexts(modelContextScope);
      if (normalized) {
        nextContexts.set(viewId, normalized);
      } else {
        nextContexts.delete(viewId);
      }
      serializeWidgetModelContexts(nextContexts);
      setWidgetModelContext(viewId, normalized);
      try {
        localStorage.setItem(
          `mcp-use:widget-state:${viewId}`,
          JSON.stringify(structuredContent)
        );
      } catch {
        // ignore quota errors
      }
    },
    [getModelContexts, modelContextScope, setWidgetModelContext, viewId]
  );

  const handleAppToolsChanged = useCallback<
    NonNullable<ViewRendererProps["onAppToolsChanged"]>
  >(
    (appToolConnection) => {
      debugMcpApps("app-tools-changed", {
        viewId,
        toolNames: appToolConnection?.tools.map((tool) => tool.name) ?? [],
      });
      setWidgetAppToolConnection(viewId, appToolConnection);
    },
    [setWidgetAppToolConnection, viewId]
  );

  const onLog = useCallback(
    ({
      level,
      data,
    }: Parameters<NonNullable<ViewRendererProps["onLog"]>>[0]) => {
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

  const fullscreenHeader = useMemo(
    () => ({
      title: server ? getServerDisplayName(server) : "MCP Server",
      iconUrl: server ? getServerIconUrl(server) : null,
    }),
    [server]
  );

  const renderFullscreenClose = useCallback(
    ({
      onClick,
      "data-testid": dataTestId,
      "aria-label": ariaLabel,
    }: {
      onClick: () => void;
      "data-testid": string;
      "aria-label": string;
    }) => (
      <Button
        type="button"
        variant="tertiary"
        size="icon-sm"
        className="rounded-full shadow-sm"
        data-testid={dataTestId}
        aria-label={ariaLabel}
        onClick={onClick}
      >
        <X />
      </Button>
    ),
    []
  );

  if (!source) return null;

  // ponytail: only shrink the iframe for mobile; desktop keeps ViewRenderer default
  const resolvedInlineMaxWidth =
    inlineMaxWidth ??
    (playground.deviceType === "mobile" ? maxWidth : undefined);

  return {
    source,
    sandboxUrl,
    hostInfo: HOST_INFO,
    hostContext,
    cspMode,
    wrapTransport,
    onCspViolation,
    onModelContextUpdate: modelContextScope
      ? handleModelContextUpdate
      : undefined,
    modelContextCapabilities: modelContextScope
      ? CHAT_MODEL_CONTEXT_CAPABILITIES
      : undefined,
    onSamplingRequest,
    onDownloadFile,
    onAppToolsChanged: modelContextScope ? handleAppToolsChanged : undefined,
    onLog,
    onResourceResolved,
    displayMode,
    onDisplayModeChange,
    inlineMaxWidth: resolvedInlineMaxWidth,
    chromeless,
    onReady,
    mockOpenAiFileApis: true,
    fullscreenHeader,
    renderFullscreenClose,
  };
}
