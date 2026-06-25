/**
 * React hook for MCP Apps widget development.
 * Uses MCP Apps postMessage as the primary protocol, with a window.openai
 * (Apps SDK) compatibility fallback for hosts that only speak the Apps SDK.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
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
  OpenAiGlobals,
  SafeArea,
  SetGlobalsEvent,
  Theme,
  UnknownObject,
  UserAgent,
  UseWidgetResult,
} from "./widget-types.js";
import { SET_GLOBALS_EVENT_TYPE } from "./widget-types.js";

/**
 * Hook to subscribe to a single value from window.openai globals.
 * Only triggers onChange when the value actually changes, to avoid redundant
 * re-renders from duplicate events (e.g. theme sync that re-sends same toolOutput).
 *
 * This powers the Apps SDK compatibility fallback. MCP Apps remains the primary
 * runtime; these values are only consumed when the MCP Apps bridge is not
 * connected (see `provider`).
 */
function useOpenAiGlobal<K extends keyof OpenAiGlobals>(
  key: K
): OpenAiGlobals[K] | undefined {
  return useSyncExternalStore(
    (onChange) => {
      // Initialize from current snapshot so redundant events with same values are ignored
      let lastValue: unknown =
        typeof window !== "undefined" && window.openai
          ? (window.openai as OpenAiGlobals)[key]
          : undefined;
      const handleSetGlobal = (event: SetGlobalsEvent) => {
        const value = event.detail.globals[key];
        if (value === undefined) {
          return;
        }
        if (value === lastValue) return;
        lastValue = value;
        onChange();
      };

      if (typeof window !== "undefined") {
        window.addEventListener(SET_GLOBALS_EVENT_TYPE, handleSetGlobal);
      }

      return () => {
        if (typeof window !== "undefined") {
          window.removeEventListener(SET_GLOBALS_EVENT_TYPE, handleSetGlobal);
        }
      };
    },
    () =>
      typeof window !== "undefined" && window.openai
        ? window.openai[key]
        : undefined
  );
}

/**
 * React hook for building MCP Apps widgets.
 *
 * Abstracts over three data providers, selected automatically:
 *
 * 1. **MCP Apps bridge** (SEP-1865 `postMessage`) — primary runtime for
 *    hosted widget iframes, including ChatGPT. The hook connects via
 *    `ui/initialize` and listens for
 *    `ui/notifications/tool-input`, `ui/notifications/tool-input-partial`,
 *    `ui/notifications/tool-result`, and `ui/notifications/host-context-changed`.
 *
 * 2. **Apps SDK fallback** (`window.openai`) — used only when the MCP Apps
 *    bridge does not connect (e.g. a host that exposes `window.openai` but does
 *    not speak the MCP Apps protocol). Data arrives via `window.openai.toolInput`
 *    / `window.openai.toolOutput` and the `openai:set_globals` custom event. MCP
 *    Apps always wins once its bridge connects, even when `window.openai` is also
 *    present (ChatGPT).
 *
 * 3. **URL params fallback** (`mcpUseParams`) — used during local development
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

  // Apps SDK availability (compatibility fallback). State so we can re-check
  // after async window.openai injection.
  const [isOpenAiAvailable, setIsOpenAiAvailable] = useState(
    () => typeof window !== "undefined" && !!window.openai
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
  const latestWidgetStateRef = useRef<TState | null>(null);

  const pushModelContextToMcpApps = useCallback((): void => {
    const bridge = getMcpAppsBridge();
    if (!bridge.isConnected()) return;

    const currentState =
      (latestWidgetStateRef.current as Record<string, unknown> | null) ?? {};
    const description = latestModelContextDescriptionRef.current;
    const hasDescription =
      description !== null && description.trim().length > 0;
    const structuredContent = hasDescription
      ? { ...currentState, [MODEL_CONTEXT_KEY]: description }
      : currentState;
    const visibleState = Object.fromEntries(
      Object.entries(currentState).filter(([key]) => key !== MODEL_CONTEXT_KEY)
    );
    const hasVisibleState = Object.keys(visibleState).length > 0;
    const text =
      hasDescription && hasVisibleState
        ? `${description}\n\nState: ${JSON.stringify(visibleState)}`
        : hasDescription
          ? description
          : hasVisibleState
            ? JSON.stringify(visibleState)
            : "";

    bridge
      .updateModelContext({
        structuredContent,
        content: [{ type: "text", text }],
      })
      .catch((err: unknown) => {
        console.warn("[ModelContext] Failed to update model context:", err);
      });
  }, []);

  // Re-check for window.openai availability after mount (in case it's injected
  // asynchronously). Powers the Apps SDK compatibility fallback.
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Initial check
    if (window.openai) {
      setIsOpenAiAvailable(true);
      return;
    }

    // Poll for window.openai if not immediately available (async script injection)
    const checkInterval = setInterval(() => {
      if (window.openai) {
        setIsOpenAiAvailable(true);
        clearInterval(checkInterval);
      }
    }, 100);

    // Also listen for the openai:set_globals event which fires when the API is ready
    const handleSetGlobals = () => {
      if (window.openai) {
        setIsOpenAiAvailable(true);
        clearInterval(checkInterval);
      }
    };
    window.addEventListener(SET_GLOBALS_EVENT_TYPE, handleSetGlobals);

    // Stop polling after 5 seconds (should be injected by then)
    const timeout = setTimeout(() => {
      clearInterval(checkInterval);
      window.removeEventListener(SET_GLOBALS_EVENT_TYPE, handleSetGlobals);
    }, 5000);

    return () => {
      clearInterval(checkInterval);
      clearTimeout(timeout);
      window.removeEventListener(SET_GLOBALS_EVENT_TYPE, handleSetGlobals);
    };
  }, []);

  // Initialize MCP Apps bridge for hosted widget iframes. ChatGPT may also
  // expose window.openai, but MCP Apps remains the primary protocol — when the
  // bridge connects it wins over the Apps SDK fallback.
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

        if (
          latestModelContextDescriptionRef.current !== null ||
          latestWidgetStateRef.current !== null
        ) {
          pushModelContextToMcpApps();
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

  // Provider selection: MCP Apps is primary. The Apps SDK (`window.openai`)
  // path is a compatibility fallback used only while/if the MCP Apps bridge is
  // not connected. A connected bridge always wins (preserves the "MCP Apps
  // primary even when window.openai is present" behavior for ChatGPT).
  const provider = useMemo(() => {
    if (!isWidgetIframe) return "mcp-ui";
    if (isMcpAppsConnected) return "mcp-apps";
    if (isOpenAiAvailable) return "openai";
    return "mcp-apps";
  }, [isWidgetIframe, isMcpAppsConnected, isOpenAiAvailable]);

  // Apps SDK globals (consumed only when provider === "openai").
  const openaiToolInput = useOpenAiGlobal("toolInput") as
    | TToolInput
    | undefined;
  const openaiToolOutput = useOpenAiGlobal("toolOutput") as
    | TOutput
    | null
    | undefined;
  const openaiResponseMetadata = useOpenAiGlobal("toolResponseMetadata") as
    | TMetadata
    | null
    | undefined;
  const openaiWidgetState = useOpenAiGlobal("widgetState") as
    | TState
    | null
    | undefined;
  const openaiTheme = useOpenAiGlobal("theme") as Theme | undefined;
  const openaiDisplayMode = useOpenAiGlobal("displayMode") as
    | DisplayMode
    | undefined;
  const openaiSafeArea = useOpenAiGlobal("safeArea") as SafeArea | undefined;
  const openaiMaxHeight = useOpenAiGlobal("maxHeight") as number | undefined;
  const openaiUserAgent = useOpenAiGlobal("userAgent") as UserAgent | undefined;
  const openaiLocale = useOpenAiGlobal("locale") as string | undefined;

  // Select data source based on provider
  const toolInput = useMemo(() => {
    if (provider === "openai") return openaiToolInput;
    if (provider === "mcp-apps")
      return mcpAppsToolInput as TToolInput | undefined;
    return urlParams.toolInput as TToolInput | undefined;
  }, [provider, openaiToolInput, mcpAppsToolInput, urlParams.toolInput]);

  const toolOutput = useMemo(() => {
    if (provider === "openai") {
      // Unwrap CallToolResult envelope if the host passed the full tool-result params
      const raw = openaiToolOutput as
        | Record<string, unknown>
        | null
        | undefined;
      if (
        raw &&
        raw.structuredContent &&
        typeof raw.structuredContent === "object"
      ) {
        return raw.structuredContent as TOutput | null | undefined;
      }
      return openaiToolOutput;
    }
    if (provider === "mcp-apps")
      return mcpAppsToolOutput as TOutput | null | undefined;
    return urlParams.toolOutput as TOutput | null | undefined;
  }, [provider, openaiToolOutput, mcpAppsToolOutput, urlParams.toolOutput]);

  // Props semantics:
  // - Widget exposed as tool: props = toolInput (args to the tool); when result arrives, props = structuredContent (tool can echo/override).
  // - Widget returned by another tool: props = structuredContent from that tool's result; toolInput = args to the parent tool.
  // Merge: use toolInput as base, structuredContent overrides. This handles both cases: during pending we show toolInput; when done, structuredContent wins.
  const widgetProps = useMemo(() => {
    const ti = (toolInput || {}) as Record<string, unknown>;
    const base = (defaultProps || {}) as Record<string, unknown> as TProps;

    // Extract structuredContent from provider-specific toolOutput.
    // Some hosts (e.g. compat runtimes bridging MCP Apps → window.openai) pass the
    // full CallToolResult envelope { content, structuredContent, _meta } as toolOutput
    // instead of pre-extracting structuredContent. Detect and unwrap when needed.
    let structuredContent: Record<string, unknown> | undefined;
    if (provider === "openai" && openaiToolOutput) {
      const raw = openaiToolOutput as Record<string, unknown>;
      if (raw.structuredContent && typeof raw.structuredContent === "object") {
        structuredContent = raw.structuredContent as Record<string, unknown>;
      } else {
        structuredContent = raw;
      }
    } else if (provider === "mcp-apps" && mcpAppsToolOutput) {
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
    openaiToolOutput,
    mcpAppsToolOutput,
    urlParams.toolOutput,
    defaultProps,
  ]);

  // Theme, displayMode, and other host context from provider
  const theme = useMemo(() => {
    if (provider === "openai") return openaiTheme;
    if (provider === "mcp-apps" && mcpAppsHostContext) {
      return mcpAppsHostContext.theme as Theme | undefined;
    }
    return undefined;
  }, [provider, openaiTheme, mcpAppsHostContext]);

  const displayMode = useMemo(() => {
    if (provider === "openai") return openaiDisplayMode;
    if (provider === "mcp-apps" && mcpAppsHostContext) {
      return mcpAppsHostContext.displayMode as DisplayMode | undefined;
    }
    return undefined;
  }, [provider, openaiDisplayMode, mcpAppsHostContext]);

  const safeArea = useMemo(() => {
    if (provider === "openai") return openaiSafeArea;
    if (provider === "mcp-apps" && mcpAppsHostContext?.safeAreaInsets) {
      return {
        insets: mcpAppsHostContext.safeAreaInsets,
      } as SafeArea;
    }
    return undefined;
  }, [provider, openaiSafeArea, mcpAppsHostContext]);

  const maxHeight = useMemo(() => {
    if (provider === "openai") return openaiMaxHeight;
    if (provider === "mcp-apps" && mcpAppsHostContext?.containerDimensions) {
      return mcpAppsHostContext.containerDimensions.maxHeight as
        | number
        | undefined;
    }
    return undefined;
  }, [provider, openaiMaxHeight, mcpAppsHostContext]);

  const maxWidth = useMemo(() => {
    if (provider === "openai") {
      // ChatGPT Apps SDK doesn't expose maxWidth
      return undefined;
    }
    if (provider === "mcp-apps" && mcpAppsHostContext?.containerDimensions) {
      return mcpAppsHostContext.containerDimensions.maxWidth as
        | number
        | undefined;
    }
    return undefined;
  }, [provider, mcpAppsHostContext]);

  const userAgent = useMemo(() => {
    if (provider === "openai") return openaiUserAgent;
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
  }, [provider, openaiUserAgent, mcpAppsHostContext]);

  const locale = useMemo(() => {
    if (provider === "openai") return openaiLocale;
    if (provider === "mcp-apps" && mcpAppsHostContext) {
      return mcpAppsHostContext.locale as string | undefined;
    }
    return undefined;
  }, [provider, openaiLocale, mcpAppsHostContext]);

  const timeZone = useMemo(() => {
    if (provider === "openai") {
      // ChatGPT Apps SDK doesn't expose timeZone, use browser default
      return typeof window !== "undefined"
        ? Intl.DateTimeFormat().resolvedOptions().timeZone
        : undefined;
    }
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
  latestWidgetStateRef.current = localWidgetState;

  // Keep a ref to the current provider so the flush handler always uses the
  // latest value without needing to re-register on every provider change.
  const providerRef = useRef(provider);
  providerRef.current = provider;

  // Sync widget state from window.openai when the Apps SDK fallback is active.
  // Gated on provider so it never clobbers MCP Apps-managed state.
  useEffect(() => {
    if (provider === "openai" && openaiWidgetState !== undefined) {
      setLocalWidgetState(openaiWidgetState);
    }
  }, [provider, openaiWidgetState]);

  // Register the model-context flush handler for the lifetime of this widget.
  // When the node tree changes, this handler is called with the serialized
  // description and pushes it to the host under MODEL_CONTEXT_KEY.
  useEffect(() => {
    const deregister = registerModelContextFlush((description) => {
      latestModelContextDescriptionRef.current = description;
      const currentProvider = providerRef.current;

      if (currentProvider === "mcp-apps") {
        pushModelContextToMcpApps();
        return;
      }

      if (currentProvider === "openai" && window.openai?.setWidgetState) {
        // Skip empty descriptions: avoids a spurious write during the brief
        // window before the MCP Apps bridge connects (ChatGPT exposes both).
        if (description === null || description.trim().length === 0) {
          return;
        }
        const prev = (window.openai.widgetState ??
          latestWidgetStateRef.current ??
          {}) as Record<string, unknown>;
        window.openai
          .setWidgetState({
            ...prev,
            [MODEL_CONTEXT_KEY]: description,
          } as UnknownObject)
          .catch((err: unknown) => {
            console.warn("[ModelContext] Failed to set widget state:", err);
          });
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
      if (provider === "openai") {
        if (!window.openai?.callTool) {
          throw new Error("window.openai.callTool is not available");
        }
        const raw = await window.openai.callTool(name, args);
        return normalizeCallToolResponse(raw);
      }

      const bridge = getMcpAppsBridge();
      const raw = await bridge.callTool(name, args);
      return normalizeCallToolResponse(raw);
    },
    [provider]
  );

  const sendFollowUpMessage = useCallback(
    async (content: string | MessageContentBlock[]): Promise<void> => {
      const contentArray: MessageContentBlock[] =
        typeof content === "string"
          ? [{ type: "text", text: content }]
          : content;

      if (provider === "openai") {
        if (!window.openai?.sendFollowUpMessage) {
          throw new Error("window.openai.sendFollowUpMessage is not available");
        }
        // window.openai only supports plain text; extract and join text blocks
        const prompt =
          typeof content === "string"
            ? content
            : contentArray
                .filter(
                  (c): c is { type: "text"; text: string } =>
                    c.type === "text" && "text" in c
                )
                .map((c) => c.text)
                .join("\n");
        return window.openai.sendFollowUpMessage({ prompt });
      }

      const bridge = getMcpAppsBridge();
      await bridge.sendMessage(contentArray);
    },
    [provider]
  );

  const openExternal = useCallback(
    (href: string): void => {
      if (provider === "openai") {
        if (!window.openai?.openExternal) {
          throw new Error("window.openai.openExternal is not available");
        }
        window.openai.openExternal({ href });
        return;
      }

      const bridge = getMcpAppsBridge();
      bridge.openLink(href).catch((error) => {
        console.error("Failed to open link:", error);
      });
    },
    [provider]
  );

  const requestDisplayMode = useCallback(
    async (mode: DisplayMode): Promise<{ mode: DisplayMode }> => {
      if (provider === "openai") {
        if (!window.openai?.requestDisplayMode) {
          throw new Error("window.openai.requestDisplayMode is not available");
        }
        return window.openai.requestDisplayMode({ mode });
      }

      const bridge = getMcpAppsBridge();
      return await bridge.requestDisplayMode(mode);
    },
    [provider]
  );

  const setState = useCallback(
    async (
      state: TState | ((prevState: TState | null) => TState)
    ): Promise<void> => {
      const currentState = latestWidgetStateRef.current;
      const newState =
        typeof state === "function"
          ? (state as (prevState: TState | null) => TState)(currentState)
          : state;

      latestWidgetStateRef.current = newState;
      setLocalWidgetState(newState);

      // Apps SDK fallback: persist via window.openai.setWidgetState, preserving
      // any prior __model_context annotation.
      if (providerRef.current === "openai") {
        if (!window.openai?.setWidgetState) {
          throw new Error("window.openai.setWidgetState is not available");
        }
        const prevModelContext = (
          (window.openai.widgetState ?? {}) as Record<string, unknown>
        )[MODEL_CONTEXT_KEY];
        return window.openai.setWidgetState(
          prevModelContext !== undefined
            ? ({
                ...(newState as Record<string, unknown>),
                [MODEL_CONTEXT_KEY]: prevModelContext,
              } as UnknownObject)
            : (newState as UnknownObject)
        );
      }

      pushModelContextToMcpApps();
    },
    [pushModelContextToMcpApps]
  );

  // Determine if tool is still executing
  const isPending = useMemo(() => {
    if (provider === "openai") {
      // Tool is pending until the host delivers either toolOutput
      // (structuredContent) or toolResponseMetadata (_meta). Checking both
      // mirrors MCP Apps and avoids staying stuck when the server omits _meta.
      return openaiToolOutput === null && openaiResponseMetadata === null;
    }
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
  }, [
    provider,
    openaiToolOutput,
    openaiResponseMetadata,
    mcpAppsToolOutput,
    toolOutput,
    urlParams.toolId,
  ]);

  // Partial/streaming tool input (available during LLM argument generation)
  const partialToolInput = useMemo(() => {
    if (provider === "mcp-apps" && mcpAppsPartialToolInput) {
      return mcpAppsPartialToolInput as Partial<TToolInput>;
    }
    // Apps SDK and URL params don't support streaming tool input.
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
      : provider === "openai"
        ? (openaiResponseMetadata ?? null)
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
    isAvailable:
      provider === "mcp-apps"
        ? isMcpAppsConnected
        : provider === "openai"
          ? isOpenAiAvailable
          : false,
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
