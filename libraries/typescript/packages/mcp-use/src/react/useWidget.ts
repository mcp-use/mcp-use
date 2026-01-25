/**
 * React hook for OpenAI Apps SDK and MCP Apps widget development
 * Wraps window.openai API (Apps SDK) and MCP Apps postMessage protocol
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { getMcpAppsBridge } from "./mcp-apps-bridge.js";
import { WIDGET_DEFAULTS } from "./constants.js";
import type {
  CallToolResponse,
  DisplayMode,
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
 * Hook to subscribe to a single value from window.openai globals
 */
function useOpenAiGlobal<K extends keyof OpenAiGlobals>(
  key: K
): OpenAiGlobals[K] | undefined {
  return useSyncExternalStore(
    (onChange) => {
      const handleSetGlobal = (event: any) => {
        const customEvent = event as SetGlobalsEvent;
        const value = customEvent.detail.globals[key];
        if (value === undefined) {
          return;
        }
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
 * React hook for building OpenAI Apps SDK widgets with MCP-use
 *
 * Provides type-safe access to the window.openai API. Widget props come from
 * _meta["mcp-use/props"] (widget-only data), while toolInput contains the original tool arguments.
 *
 * @example
 * ```tsx
 * const MyWidget: React.FC = () => {
 *   const { props, toolInput, output, theme } = useWidget<
 *     { city: string; temperature: number },  // Props (widget-only)
 *     string,                                  // Output (model sees)
 *     {},                                      // Metadata
 *     {},                                      // State
 *     { city: string }                         // ToolInput (tool args)
 *   >();
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
  TProps extends UnknownObject = UnknownObject,
  TOutput extends UnknownObject = UnknownObject,
  TMetadata extends UnknownObject = UnknownObject,
  TState extends UnknownObject = UnknownObject,
  TToolInput extends UnknownObject = UnknownObject,
>(
  defaultProps?: TProps
): UseWidgetResult<TProps, TOutput, TMetadata, TState, TToolInput> {
  // Check if window.openai is available - use state to allow re-checking after async injection
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
  const [mcpAppsHostContext, setMcpAppsHostContext] = useState<any>(null);

  // Re-check for window.openai availability after mount (in case it's injected asynchronously)
  useEffect(() => {
    // Initial check
    if (typeof window !== "undefined" && window.openai) {
      setIsOpenAiAvailable(true);
      return;
    }

    // Poll for window.openai if not immediately available (for async script injection)
    const checkInterval = setInterval(() => {
      if (typeof window !== "undefined" && window.openai) {
        setIsOpenAiAvailable(true);
        clearInterval(checkInterval);
      }
    }, 100);

    // Also listen for the openai:set_globals event which fires when the API is ready
    const handleSetGlobals = () => {
      if (typeof window !== "undefined" && window.openai) {
        setIsOpenAiAvailable(true);
        clearInterval(checkInterval);
      }
    };

    if (typeof window !== "undefined") {
      window.addEventListener(SET_GLOBALS_EVENT_TYPE, handleSetGlobals);
    }

    // Cleanup after 5 seconds max (should be injected by then)
    const timeout = setTimeout(() => {
      clearInterval(checkInterval);
      if (typeof window !== "undefined") {
        window.removeEventListener(SET_GLOBALS_EVENT_TYPE, handleSetGlobals);
      }
    }, 5000);

    return () => {
      clearInterval(checkInterval);
      clearTimeout(timeout);
      if (typeof window !== "undefined") {
        window.removeEventListener(SET_GLOBALS_EVENT_TYPE, handleSetGlobals);
      }
    };
  }, []);

  // Initialize MCP Apps bridge if not in Apps SDK mode
  useEffect(() => {
    // Only try MCP Apps if window.openai is not available and we're in an iframe
    if (
      typeof window === "undefined" ||
      window.openai ||
      window === window.parent
    ) {
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
        const hostContext = bridge.getHostContext();

        if (toolInput) setMcpAppsToolInput(toolInput);
        if (toolOutput) setMcpAppsToolOutput(toolOutput);
        if (hostContext) setMcpAppsHostContext(hostContext);
      })
      .catch((error) => {
        console.warn("[useWidget] Failed to connect to MCP Apps host:", error);
      });

    // Subscribe to updates
    const unsubToolInput = bridge.onToolInput((input) => {
      setMcpAppsToolInput(input);
    });

    const unsubToolResult = bridge.onToolResult((result) => {
      setMcpAppsToolOutput(result);
    });

    const unsubHostContext = bridge.onHostContextChange((context) => {
      console.log("[useWidget] Host context change received:", context);
      setMcpAppsHostContext(context);
    });

    return () => {
      unsubToolInput();
      unsubToolResult();
      unsubHostContext();
    };
  }, []);

  const provider = useMemo(() => {
    if (isOpenAiAvailable) return "openai";
    if (isMcpAppsConnected) return "mcp-apps";
    return "mcp-ui";
  }, [isOpenAiAvailable, isMcpAppsConnected]);

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

  // Always subscribe to openai globals (hooks must be called unconditionally)
  const openaiToolInput = useOpenAiGlobal("toolInput") as
    | TToolInput
    | undefined;
  const openaiToolOutput = useOpenAiGlobal("toolOutput") as
    | TOutput
    | null
    | undefined;
  const toolResponseMetadata = useOpenAiGlobal("toolResponseMetadata") as
    | TMetadata
    | null
    | undefined;
  const widgetState = useOpenAiGlobal("widgetState") as
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
    if (provider === "openai") return openaiToolOutput;
    if (provider === "mcp-apps")
      return mcpAppsToolOutput as TOutput | null | undefined;
    return urlParams.toolOutput as TOutput | null | undefined;
  }, [provider, openaiToolOutput, mcpAppsToolOutput, urlParams.toolOutput]);

  // Extract widget props based on provider
  const widgetProps = useMemo(() => {
    // Apps SDK: Props from toolResponseMetadata["mcp-use/props"]
    if (
      provider === "openai" &&
      toolResponseMetadata &&
      typeof toolResponseMetadata === "object"
    ) {
      const metaProps = (toolResponseMetadata as any)["mcp-use/props"];
      if (metaProps) {
        return metaProps as TProps;
      }
    }

    // MCP Apps: Props come from tool input (arguments)
    if (provider === "mcp-apps" && mcpAppsToolInput) {
      return mcpAppsToolInput as TProps;
    }

    return defaultProps || ({} as TProps);
  }, [provider, toolResponseMetadata, mcpAppsToolInput, defaultProps]);

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

  // Use local state for widget state with sync to window.openai
  const [localWidgetState, setLocalWidgetState] = useState<TState | null>(null);

  // Sync widget state from window.openai
  useEffect(() => {
    if (widgetState !== undefined) {
      setLocalWidgetState(widgetState);
    }
  }, [widgetState]);

  // Stable API methods
  const callTool = useCallback(
    async (
      name: string,
      args: Record<string, unknown>
    ): Promise<CallToolResponse> => {
      if (provider === "mcp-apps") {
        const bridge = getMcpAppsBridge();
        const result = await bridge.callTool(name, args);
        // Convert to CallToolResponse format
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
        };
      }

      if (!window.openai?.callTool) {
        throw new Error("window.openai.callTool is not available");
      }
      return window.openai.callTool(name, args);
    },
    [provider]
  );

  const sendFollowUpMessage = useCallback(
    async (prompt: string): Promise<void> => {
      if (provider === "mcp-apps") {
        const bridge = getMcpAppsBridge();
        await bridge.sendMessage({ type: "text", text: prompt });
        return;
      }

      if (!window.openai?.sendFollowUpMessage) {
        throw new Error("window.openai.sendFollowUpMessage is not available");
      }
      return window.openai.sendFollowUpMessage({ prompt });
    },
    [provider]
  );

  const openExternal = useCallback(
    (href: string): void => {
      if (provider === "mcp-apps") {
        const bridge = getMcpAppsBridge();
        bridge.openLink(href).catch((error) => {
          console.error("Failed to open link:", error);
        });
        return;
      }

      if (!window.openai?.openExternal) {
        throw new Error("window.openai.openExternal is not available");
      }
      window.openai.openExternal({ href });
    },
    [provider]
  );

  const requestDisplayMode = useCallback(
    async (mode: DisplayMode): Promise<{ mode: DisplayMode }> => {
      if (provider === "mcp-apps") {
        const bridge = getMcpAppsBridge();
        return await bridge.requestDisplayMode(mode);
      }

      if (!window.openai?.requestDisplayMode) {
        throw new Error("window.openai.requestDisplayMode is not available");
      }
      return window.openai.requestDisplayMode({ mode });
    },
    [provider]
  );

  const setState = useCallback(
    async (
      state: TState | ((prevState: TState | null) => TState)
    ): Promise<void> => {
      // MCP Apps doesn't support widget state persistence
      if (provider === "mcp-apps") {
        const currentState = localWidgetState;
        const newState =
          typeof state === "function" ? state(currentState) : state;
        setLocalWidgetState(newState);
        return;
      }

      if (!window.openai?.setWidgetState) {
        throw new Error("window.openai.setWidgetState is not available");
      }

      // Use functional update to always get latest state
      // Prefer widgetState (from window.openai) over localWidgetState for most up-to-date value
      const currentState =
        widgetState !== undefined ? widgetState : localWidgetState;
      const newState =
        typeof state === "function" ? state(currentState) : state;

      setLocalWidgetState(newState);
      return window.openai.setWidgetState(newState);
    },
    [provider, widgetState, localWidgetState]
  );

  // Determine if tool is still executing
  const isPending = useMemo(() => {
    if (provider === "openai") {
      // When widget first loads before tool completes, toolResponseMetadata is null
      return toolResponseMetadata === null;
    }
    if (provider === "mcp-apps") {
      // In MCP Apps, widget is pending until we receive tool-input notification
      return mcpAppsToolInput === null;
    }
    return false;
  }, [provider, toolResponseMetadata, mcpAppsToolInput]);

  return {
    // Props and state (with defaults)
    props: widgetProps,
    toolInput: (toolInput || {}) as TToolInput,
    output: (toolOutput ?? null) as TOutput | null,
    metadata: (toolResponseMetadata ?? null) as TMetadata | null,
    state: localWidgetState,
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
    isAvailable: isOpenAiAvailable || isMcpAppsConnected,
    isPending,
  };
}

/**
 * Hook to get just the widget props (most common use case)
 * @example
 * ```tsx
 * const props = useWidgetProps<{ city: string; temperature: number }>();
 * ```
 */
export function useWidgetProps<TProps extends UnknownObject = UnknownObject>(
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
export function useWidgetState<TState extends UnknownObject>(
  defaultState?: TState
): readonly [
  TState | null,
  (state: TState | ((prev: TState | null) => TState)) => Promise<void>,
] {
  const { state, setState } = useWidget<
    UnknownObject,
    UnknownObject,
    UnknownObject,
    TState
  >();

  // Initialize with default if provided and state is null
  useEffect(() => {
    if (
      state === null &&
      defaultState !== undefined &&
      window.openai?.setWidgetState
    ) {
      setState(defaultState);
    }
  }, []); // Only run once on mount

  return [state, setState] as const;
}
