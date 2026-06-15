/**
 * React hook for MCP Apps widget development.
 * Uses MCP Apps postMessage as the base protocol and keeps window.openai
 * available for extension APIs.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getMcpAppsBridge } from "./mcp-apps-bridge.js";
import { WIDGET_DEFAULTS } from "./constants.js";
import { normalizeCallToolResponse } from "./widget-utils.js";
import {
  MODEL_CONTEXT_KEY,
  registerModelContextFlush,
} from "./model-context.js";
import type {
  CallToolResponse,
  DisplayMode,
  HostContext,
  MessageContentBlock,
  SafeArea,
  Theme,
  UnknownObject,
  UserAgent,
  UseWidgetResult,
} from "./widget-types.js";

/**
 * React hook for building MCP Apps widgets.
 *
 * Abstracts over two data providers, selected automatically:
 *
 * 1. **MCP Apps bridge** (SEP-1865 `postMessage`) — primary runtime for
 *    hosted widget iframes, including ChatGPT. The hook connects via
 *    `ui/initialize` and listens for
 *    `ui/notifications/tool-input`, `ui/notifications/tool-input-partial`,
 *    `ui/notifications/tool-result`, and `ui/notifications/host-context-changed`.
 *
 * 2. **URL params fallback** (`mcpUseParams`) — used during local development
 *    (`mcp-use dev` inspector) where `toolInput` and `toolOutput` are injected
 *    via the query string. No live streaming in this mode.
 *
 * ### Data flow (per SEP-1865)
 *
 * ```
 * LLM calls tool → host sends tool-input → widget receives toolInput
 *                → host executes tool  → host sends tool-result
 *                                       → widget receives props (structuredContent)
 * ```
 *
 * The server controls what the **LLM** sees (`content` text array) separately
 * from what the **widget** sees (`structuredContent` / `props`). This lets the
 * tool return rich structured data for rendering without polluting the model's
 * context.
 *
 * ### Key fields
 *
 * - `isPending` — `true` until the tool result arrives; `props` is `Partial<TProps>` while pending.
 * - `props` — merged from toolInput (base) and structuredContent (overlay). When the widget is
 *   exposed as a tool, props = toolInput during pending and structuredContent when done. When
 *   the widget is returned by another tool, props = structuredContent (toolInput = parent's args).
 * - `toolInput` — the arguments the model passed to the tool.
 * - `partialToolInput` / `isStreaming` — real-time argument streaming (MCP Apps only).
 * - `theme`, `displayMode`, `locale`, `timeZone`, `safeArea`, `maxHeight` — host context.
 * - `callTool`, `sendFollowUpMessage`, `openExternal`, `requestDisplayMode` — host actions.
 * - `state` / `setState` — persisted state visible to the model on future turns.
 *
 * @example
 * ```tsx
 * const MyWidget: React.FC = () => {
 *   const { props, isPending, toolInput, theme } = useWidget<
 *     { city: string; temperature: number },  // Props (from structuredContent)
 *     {},                                      // State
 *     { city: string; temperature: number },  // Output type
 *     {},                                      // Metadata
 *     { city: string }                         // ToolInput (tool call args)
 *   >();
 *
 *   if (isPending) return <p>Loading…</p>;
 *
 *   return (
 *     <div data-theme={theme}>
 *       <h1>{props.city}</h1>
 *       <p>{props.temperature}°C</p>
 *       <p>Requested: {toolInput.city}</p>
 *     </div>
 *   );
 * };
 * ```
 */
export function useWidget<
  TProps = UnknownObject,
  TState = UnknownObject,
  TOutput = UnknownObject,
  TMetadata = UnknownObject,
  TToolInput = UnknownObject,
>(
  defaultProps?: TProps
): UseWidgetResult<TProps, TState, TOutput, TMetadata, TToolInput> {
  const isWidgetIframe = useMemo(
    () => typeof window !== "undefined" && window !== window.parent,
    []
  );

  // Check if MCP Apps bridge is available
  const [isMcpAppsConnected, setIsMcpAppsConnected] = useState(false);
  const [mcpAppsToolInput, setMcpAppsToolInput] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [mcpAppsToolOutput, setMcpAppsToolOutput] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [mcpAppsResponseMetadata, setMcpAppsResponseMetadata] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [mcpAppsPartialToolInput, setMcpAppsPartialToolInput] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [mcpAppsHostContext, setMcpAppsHostContext] =
    useState<HostContext | null>(null);
  const [mcpAppsHostInfo, setMcpAppsHostInfo] = useState<{
    name: string;
    version: string;
  } | null>(null);
  const [mcpAppsHostCapabilities, setMcpAppsHostCapabilities] = useState<Record<
    string,
    unknown
  > | null>(null);

  const latestModelContextDescriptionRef = useRef<string | null>(null);

  const pushModelContextToMcpApps = useCallback((description: string): void => {
    const bridge = getMcpAppsBridge();
    if (!bridge.isConnected()) return;

    bridge
      .updateModelContext({
        structuredContent: { [MODEL_CONTEXT_KEY]: description },
        content: [{ type: "text", text: description }],
      })
      .catch((err: unknown) => {
        console.warn("[ModelContext] Failed to update model context:", err);
      });
  }, []);

  // Initialize MCP Apps bridge for hosted widget iframes. ChatGPT may also
  // expose window.openai, but MCP Apps remains the base protocol.
  useEffect(() => {
    if (!isWidgetIframe || typeof window === "undefined") {
      return;
    }

    const bridge = getMcpAppsBridge();

    // Try to connect
    bridge
      .connect()
      .then(() => {
        setIsMcpAppsConnected(true);

        // Get initial state
        const toolInput = bridge.getToolInput();
        const toolOutput = bridge.getToolOutput();
        const responseMeta = bridge.getToolResponseMetadata();
        const hostContext = bridge.getHostContext();
        const partialToolInput = bridge.getPartialToolInput();

        if (toolInput) setMcpAppsToolInput(toolInput);
        if (toolOutput) setMcpAppsToolOutput(toolOutput);
        if (responseMeta) setMcpAppsResponseMetadata(responseMeta);
        if (partialToolInput) setMcpAppsPartialToolInput(partialToolInput);
        if (hostContext) setMcpAppsHostContext(hostContext);

        const hostInfo = bridge.getHostInfo();
        const hostCapabilities = bridge.getHostCapabilities();
        if (hostInfo) setMcpAppsHostInfo(hostInfo);
        if (hostCapabilities) setMcpAppsHostCapabilities(hostCapabilities);

        const description = latestModelContextDescriptionRef.current;
        if (description !== null) {
          pushModelContextToMcpApps(description);
        }
      })
      .catch((error) => {
        console.warn("[useWidget] Failed to connect to MCP Apps host:", error);
      });

    // Subscribe to updates
    const unsubToolInput = bridge.onToolInput((input) => {
      setMcpAppsToolInput(input);
    });

    const unsubToolInputPartial = bridge.onToolInputPartial((input) => {
      setMcpAppsPartialToolInput(input);
    });

    const unsubToolResult = bridge.onToolResult((result) => {
      setMcpAppsToolOutput(result);
      setMcpAppsResponseMetadata(bridge.getToolResponseMetadata());
      setMcpAppsPartialToolInput(null);
    });

    const unsubHostContext = bridge.onHostContextChange((context) => {
      console.log("[useWidget] Host context change received:", context);
      setMcpAppsHostContext(context);
    });

    return () => {
      unsubToolInput();
      unsubToolInputPartial();
      unsubToolResult();
      unsubHostContext();
    };
  }, [pushModelContextToMcpApps, isWidgetIframe]);

  // Extract search string to avoid dependency issues
  const searchString =
    typeof window !== "undefined" ? window.location.search : "";

  const urlParams = useMemo(() => {
    // check if it has mcpUseParams
    const urlParams = new URLSearchParams(searchString);
    if (urlParams.has("mcpUseParams")) {
      return JSON.parse(urlParams.get("mcpUseParams") as string) as {
        toolInput: TProps;
        toolOutput: TOutput;
        toolId: string;
      };
    }
    return {
      toolInput: {} as TProps,
      toolOutput: {} as TOutput,
      toolId: "",
    };
  }, [searchString]);

  const provider = useMemo(() => {
    return isWidgetIframe ? "mcp-apps" : "mcp-ui";
  }, [isWidgetIframe]);

  // Select data source based on provider
  const toolInput = useMemo(() => {
    if (provider === "mcp-apps")
      return mcpAppsToolInput as TToolInput | undefined;
    return urlParams.toolInput as TToolInput | undefined;
  }, [provider, mcpAppsToolInput, urlParams.toolInput]);

  const toolOutput = useMemo(() => {
    if (provider === "mcp-apps")
      return mcpAppsToolOutput as TOutput | null | undefined;
    return urlParams.toolOutput as TOutput | null | undefined;
  }, [provider, mcpAppsToolOutput, urlParams.toolOutput]);

  // Props semantics:
  // - Widget exposed as tool: props = toolInput (args to the tool); when result arrives, props = structuredContent (tool can echo/override).
  // - Widget returned by another tool: props = structuredContent from that tool's result; toolInput = args to the parent tool.
  // Merge: use toolInput as base, structuredContent overrides. This handles both cases: during pending we show toolInput; when done, structuredContent wins.
  const widgetProps = useMemo(() => {
    const ti = (toolInput || {}) as Record<string, unknown>;
    const base = (defaultProps || {}) as Record<string, unknown> as TProps;

    // Extract structuredContent from provider-specific toolOutput.
    let structuredContent: Record<string, unknown> | undefined;
    if (provider === "mcp-apps" && mcpAppsToolOutput) {
      structuredContent = mcpAppsToolOutput as Record<string, unknown>;
    } else if (provider === "mcp-ui" && urlParams.toolOutput) {
      structuredContent = urlParams.toolOutput as Record<string, unknown>;
    }

    // Base: toolInput (for exposed-as-tool) or defaultProps; overlay: structuredContent
    const merged = { ...base, ...ti, ...(structuredContent || {}) } as TProps;
    return merged;
  }, [
    provider,
    toolInput,
    mcpAppsToolOutput,
    urlParams.toolOutput,
    defaultProps,
  ]);

  // Theme, displayMode, and other host context from provider
  const theme = useMemo(() => {
    if (provider === "mcp-apps" && mcpAppsHostContext) {
      return mcpAppsHostContext.theme as Theme | undefined;
    }
    return undefined;
  }, [provider, mcpAppsHostContext]);

  const displayMode = useMemo(() => {
    if (provider === "mcp-apps" && mcpAppsHostContext) {
      return mcpAppsHostContext.displayMode as DisplayMode | undefined;
    }
    return undefined;
  }, [provider, mcpAppsHostContext]);

  const safeArea = useMemo(() => {
    if (provider === "mcp-apps" && mcpAppsHostContext?.safeAreaInsets) {
      return {
        insets: mcpAppsHostContext.safeAreaInsets,
      } as SafeArea;
    }
    return undefined;
  }, [provider, mcpAppsHostContext]);

  const maxHeight = useMemo(() => {
    if (provider === "mcp-apps" && mcpAppsHostContext?.containerDimensions) {
      return mcpAppsHostContext.containerDimensions.maxHeight as
        | number
        | undefined;
    }
    return undefined;
  }, [provider, mcpAppsHostContext]);

  const maxWidth = useMemo(() => {
    if (provider === "mcp-apps" && mcpAppsHostContext?.containerDimensions) {
      return mcpAppsHostContext.containerDimensions.maxWidth as
        | number
        | undefined;
    }
    return undefined;
  }, [provider, mcpAppsHostContext]);

  const userAgent = useMemo(() => {
    if (provider === "mcp-apps" && mcpAppsHostContext) {
      // Map MCP Apps device capabilities to UserAgent format
      return {
        device: {
          type: (mcpAppsHostContext.platform === "mobile"
            ? "mobile"
            : "desktop") as any,
        },
        capabilities: {
          hover: mcpAppsHostContext.deviceCapabilities?.hover ?? false,
          touch: mcpAppsHostContext.deviceCapabilities?.touch ?? false,
        },
      } as UserAgent;
    }
    return undefined;
  }, [provider, mcpAppsHostContext]);

  const locale = useMemo(() => {
    if (provider === "mcp-apps" && mcpAppsHostContext) {
      return mcpAppsHostContext.locale as string | undefined;
    }
    return undefined;
  }, [provider, mcpAppsHostContext]);

  const timeZone = useMemo(() => {
    if (provider === "mcp-apps" && mcpAppsHostContext) {
      return mcpAppsHostContext.timeZone as string | undefined;
    }
    return undefined;
  }, [provider, mcpAppsHostContext]);

  // Compute MCP server base URL from window.__mcpPublicUrl
  const mcp_url = useMemo(() => {
    if (typeof window !== "undefined" && window.__mcpPublicUrl) {
      // Remove the /mcp-use/public suffix to get the base server URL
      return window.__mcpPublicUrl.replace(/\/mcp-use\/public$/, "");
    }
    return "";
  }, []);

  // Use local state for widget state. MCP Apps state is local + model context
  // updates via ui/update-model-context.
  const [localWidgetState, setLocalWidgetState] = useState<TState | null>(null);

  // Keep a ref to the current provider so the flush handler always uses the
  // latest value without needing to re-register on every provider change.
  const providerRef = useRef(provider);
  providerRef.current = provider;

  // Register the model-context flush handler for the lifetime of this widget.
  // When the node tree changes, this handler is called with the serialized
  // description and pushes it to the host under MODEL_CONTEXT_KEY.
  useEffect(() => {
    const deregister = registerModelContextFlush((description) => {
      latestModelContextDescriptionRef.current = description;
      const currentProvider = providerRef.current;

      if (currentProvider === "mcp-apps") {
        pushModelContextToMcpApps(description);
      }
    });
    return deregister;
  }, [pushModelContextToMcpApps]);

  // Stable API methods
  const callTool = useCallback(
    async (
      name: string,
      args: Record<string, unknown>
    ): Promise<CallToolResponse> => {
      const bridge = getMcpAppsBridge();
      const raw = await bridge.callTool(name, args);
      return normalizeCallToolResponse(raw);
    },
    []
  );

  const sendFollowUpMessage = useCallback(
    async (content: string | MessageContentBlock[]): Promise<void> => {
      const contentArray: MessageContentBlock[] =
        typeof content === "string"
          ? [{ type: "text", text: content }]
          : content;

      const bridge = getMcpAppsBridge();
      await bridge.sendMessage(contentArray);
    },
    []
  );

  const openExternal = useCallback((href: string): void => {
    const bridge = getMcpAppsBridge();
    bridge.openLink(href).catch((error) => {
      console.error("Failed to open link:", error);
    });
  }, []);

  const requestDisplayMode = useCallback(
    async (mode: DisplayMode): Promise<{ mode: DisplayMode }> => {
      const bridge = getMcpAppsBridge();
      return await bridge.requestDisplayMode(mode);
    },
    []
  );

  const setState = useCallback(
    async (
      state: TState | ((prevState: TState | null) => TState)
    ): Promise<void> => {
      const currentState = localWidgetState;
      const newState =
        typeof state === "function"
          ? (state as (prevState: TState | null) => TState)(currentState)
          : state;

      setLocalWidgetState(newState);

      const bridge = getMcpAppsBridge();
      const structuredContent = newState as Record<string, unknown>;
      bridge
        .updateModelContext({
          structuredContent,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                Object.fromEntries(
                  Object.entries(structuredContent).filter(
                    ([k]) => k !== MODEL_CONTEXT_KEY
                  )
                )
              ),
            },
          ],
        })
        .catch((err) => {
          console.warn("[useWidget] Failed to update model context:", err);
        });
    },
    [localWidgetState]
  );

  // Determine if tool is still executing
  const isPending = useMemo(() => {
    if (provider === "mcp-apps") {
      // In MCP Apps, widget is pending until we receive tool-result notification
      // We check toolOutput instead of toolInput because input is sent immediately
      return mcpAppsToolOutput === null;
    }
    // For mcp-ui (URL params), check if toolOutput is null (tool hasn't completed)
    if (provider === "mcp-ui") {
      // If we're in an iframe without actual URL params, we're in a transitional
      // state before the MCP Apps bridge connects. Stay pending to avoid rendering
      // with empty props.
      if (
        typeof window !== "undefined" &&
        window !== window.parent &&
        !urlParams.toolId
      ) {
        return true;
      }
      return toolOutput === null || toolOutput === undefined;
    }
    return false;
  }, [provider, mcpAppsToolOutput, toolOutput, urlParams.toolId]);

  // Partial/streaming tool input (available during LLM argument generation)
  const partialToolInput = useMemo(() => {
    if (provider === "mcp-apps" && mcpAppsPartialToolInput) {
      return mcpAppsPartialToolInput as Partial<TToolInput>;
    }
    // URL params don't support streaming tool input.
    return null;
  }, [provider, mcpAppsPartialToolInput]);

  // Whether tool arguments are currently being streamed
  const isStreaming = useMemo(() => {
    if (provider === "mcp-apps") {
      // Streaming when we have partial input data available.
      // Don't gate on mcpAppsToolInput === null — React batches state updates
      // from tool-input-partial and tool-input together, so toolInput is often
      // already set by the time React renders. partialToolInput being non-null
      // is the authoritative signal that streaming data exists.
      return mcpAppsPartialToolInput !== null;
    }
    return false;
  }, [provider, mcpAppsPartialToolInput]);

  return {
    // Props and state (with defaults)
    props: widgetProps,
    toolInput: (toolInput || {}) as TToolInput,
    output: (toolOutput ?? null) as TOutput | null,
    metadata: (provider === "mcp-apps"
      ? (mcpAppsResponseMetadata ?? null)
      : null) as TMetadata | null,
    state: localWidgetState
      ? (Object.fromEntries(
          Object.entries(localWidgetState as Record<string, unknown>).filter(
            ([k]) => k !== MODEL_CONTEXT_KEY
          )
        ) as TState)
      : null,
    setState,

    // Layout and theme (with safe defaults)
    theme: theme || "light",
    displayMode: displayMode || "inline",
    safeArea: safeArea || { insets: { top: 0, bottom: 0, left: 0, right: 0 } },
    maxHeight: maxHeight || 600,
    maxWidth: maxWidth,
    userAgent: userAgent || {
      device: { type: "desktop" },
      capabilities: { hover: true, touch: false },
    },
    locale: locale || WIDGET_DEFAULTS.LOCALE,
    timeZone:
      timeZone ||
      (typeof window !== "undefined"
        ? Intl.DateTimeFormat().resolvedOptions().timeZone
        : "UTC"),
    mcp_url,

    // Actions
    callTool,
    sendFollowUpMessage,
    openExternal,
    requestDisplayMode,

    // Availability
    isAvailable: provider === "mcp-apps" ? isMcpAppsConnected : false,
    isPending,

    // Streaming
    partialToolInput,
    isStreaming,

    // Host identity (MCP Apps only)
    hostInfo: mcpAppsHostInfo ?? undefined,
    hostCapabilities: mcpAppsHostCapabilities ?? undefined,
    hostContext: mcpAppsHostContext ?? undefined,
  } as UseWidgetResult<TProps, TState, TOutput, TMetadata, TToolInput>;
}

/**
 * Hook to get just the widget props (most common use case)
 * @example
 * ```tsx
 * const props = useWidgetProps<{ city: string; temperature: number }>();
 * ```
 */
export function useWidgetProps<TProps = UnknownObject>(
  defaultProps?: TProps
): Partial<TProps> {
  const { props } = useWidget<TProps>(defaultProps);
  return props;
}

/**
 * Hook to get theme value
 * @example
 * ```tsx
 * const theme = useWidgetTheme();
 * ```
 */
export function useWidgetTheme(): Theme {
  const { theme } = useWidget();
  return theme;
}

/**
 * Hook to get and update widget state
 * @example
 * ```tsx
 * const [favorites, setFavorites] = useWidgetState<string[]>([]);
 * ```
 */
export function useWidgetState<TState>(
  defaultState?: TState
): readonly [
  TState | null,
  (state: TState | ((prev: TState | null) => TState)) => Promise<void>,
] {
  const widget = useWidget<UnknownObject, TState>();
  const { state, setState, isAvailable } = widget;

  // Initialize with default if provided and state is null
  useEffect(() => {
    if (state === null && defaultState !== undefined && isAvailable) {
      setState(defaultState);
    }
  }, [defaultState, isAvailable, setState, state]);

  return [state, setState] as const;
}
