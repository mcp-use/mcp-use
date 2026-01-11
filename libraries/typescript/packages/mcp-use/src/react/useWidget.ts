/**
 * React hook for OpenAI Apps SDK widget development
 * Wraps window.openai API and adapts MCP UI props to toolInput
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
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

  const provider = useMemo(() => {
    return isOpenAiAvailable ? "openai" : "mcp-ui";
  }, [isOpenAiAvailable]);

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

  // Subscribe to globals
  const toolInput =
    provider === "openai"
      ? (useOpenAiGlobal("toolInput") as TToolInput | undefined)
      : (urlParams.toolInput as TToolInput | undefined);
  const toolOutput =
    provider === "openai"
      ? (useOpenAiGlobal("toolOutput") as TOutput | null | undefined)
      : (urlParams.toolOutput as TOutput | null | undefined);
  const toolResponseMetadata = useOpenAiGlobal("toolResponseMetadata") as
    | TMetadata
    | null
    | undefined;

  // Extract widget props from toolResponseMetadata["mcp-use/props"]
  const widgetProps = useMemo(() => {
    if (toolResponseMetadata && typeof toolResponseMetadata === "object") {
      const metaProps = (toolResponseMetadata as any)["mcp-use/props"];
      if (metaProps) {
        return metaProps as TProps;
      }
    }
    return defaultProps || ({} as TProps);
  }, [toolResponseMetadata, defaultProps]);
  const widgetState = useOpenAiGlobal("widgetState") as
    | TState
    | null
    | undefined;
  const theme = useOpenAiGlobal("theme") as Theme | undefined;
  const displayMode = useOpenAiGlobal("displayMode") as DisplayMode | undefined;
  const safeArea = useOpenAiGlobal("safeArea") as SafeArea | undefined;
  const maxHeight = useOpenAiGlobal("maxHeight") as number | undefined;
  const userAgent = useOpenAiGlobal("userAgent") as UserAgent | undefined;
  const locale = useOpenAiGlobal("locale") as string | undefined;

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
      if (!window.openai?.callTool) {
        throw new Error("window.openai.callTool is not available");
      }
      return window.openai.callTool(name, args);
    },
    []
  );

  const sendFollowUpMessage = useCallback(
    async (prompt: string): Promise<void> => {
      if (!window.openai?.sendFollowUpMessage) {
        throw new Error("window.openai.sendFollowUpMessage is not available");
      }
      return window.openai.sendFollowUpMessage({ prompt });
    },
    []
  );

  const openExternal = useCallback((href: string): void => {
    if (!window.openai?.openExternal) {
      throw new Error("window.openai.openExternal is not available");
    }
    window.openai.openExternal({ href });
  }, []);

  const requestDisplayMode = useCallback(
    async (mode: DisplayMode): Promise<{ mode: DisplayMode }> => {
      if (!window.openai?.requestDisplayMode) {
        throw new Error("window.openai.requestDisplayMode is not available");
      }
      return window.openai.requestDisplayMode({ mode });
    },
    []
  );

  const setState = useCallback(
    async (
      state: TState | ((prevState: TState | null) => TState)
    ): Promise<void> => {
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
    [widgetState, localWidgetState]
  );

  // Determine if tool is still executing
  // When widget first loads before tool completes, toolResponseMetadata is null
  const isPending = useMemo(() => {
    return provider === "openai" && toolResponseMetadata === null;
  }, [provider, toolResponseMetadata]);

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
    userAgent: userAgent || {
      device: { type: "desktop" },
      capabilities: { hover: true, touch: false },
    },
    locale: locale || "en",
    mcp_url,

    // Actions
    callTool,
    sendFollowUpMessage,
    openExternal,
    requestDisplayMode,

    // Availability
    isAvailable: isOpenAiAvailable,
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
): TProps {
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
