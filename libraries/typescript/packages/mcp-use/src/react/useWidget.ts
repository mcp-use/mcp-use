/**
 * React hook for widget development across multiple host environments
 *
 * Supports three host types:
 * - apps-sdk: OpenAI Apps SDK (ChatGPT native widgets)
 * - mcp-app: MCP Apps standard (SEP-1865 compliant hosts)
 * - standalone: Inspector, development, testing mode
 *
 * The hook provides a unified API regardless of the host environment,
 * with the adaptor pattern handling the underlying communication differences.
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
  SafeArea,
  Theme,
  UnknownObject,
  UserAgent,
} from "./widget-types.js";
import { createHostAdaptor, type HostType } from "./host/index.js";

/**
 * Extended result type for the useWidget hook
 */
export interface UseWidgetResult<
  TProps extends UnknownObject = UnknownObject,
  TOutput extends UnknownObject = UnknownObject,
  TMetadata extends UnknownObject = UnknownObject,
  TState extends UnknownObject = UnknownObject,
  TToolInput extends UnknownObject = UnknownObject,
> {
  // Props and state
  /** Widget props from _meta["mcp-use/props"] (widget-only data, hidden from model) */
  props: TProps;
  /** Original tool input arguments */
  toolInput: TToolInput;
  /** Tool output from the last execution */
  output: TOutput | null;
  /** Response metadata from the tool */
  metadata: TMetadata | null;
  /** Persisted widget state */
  state: TState | null;
  /** Update widget state (persisted and shown to model) */
  setState: (
    state: TState | ((prevState: TState | null) => TState)
  ) => Promise<void>;

  // Layout and theme
  /** Current theme (light/dark) */
  theme: Theme;
  /** Current display mode */
  displayMode: DisplayMode;
  /** Safe area insets for layout */
  safeArea: SafeArea;
  /** Maximum height available */
  maxHeight: number;
  /** User agent information */
  userAgent: UserAgent;
  /** Current locale */
  locale: string;
  /** MCP server base URL for making API requests */
  mcp_url: string;

  // Actions
  /** Call a tool on the MCP server */
  callTool: (
    name: string,
    args: Record<string, unknown>
  ) => Promise<CallToolResponse>;
  /** Send a follow-up message to the conversation */
  sendFollowUpMessage: (prompt: string) => Promise<void>;
  /** Open an external URL */
  openExternal: (href: string) => void;
  /** Request a different display mode */
  requestDisplayMode: (mode: DisplayMode) => Promise<{ mode: DisplayMode }>;

  /** Whether the widget API is available */
  isAvailable: boolean;
  /** Whether the tool is currently executing (metadata is null) */
  isPending: boolean;

  /** The current host environment type */
  hostType: HostType;
}

/**
 * Get or create the singleton adaptor instance
 */
function getAdaptor() {
  return createHostAdaptor();
}

/**
 * React hook for building widgets that work across multiple host environments
 *
 * Provides type-safe access to host APIs through a unified interface.
 * Widget props come from _meta["mcp-use/props"] (widget-only data),
 * while toolInput contains the original tool arguments.
 *
 * @example
 * ```tsx
 * const MyWidget: React.FC = () => {
 *   const { props, toolInput, output, theme, hostType } = useWidget<
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
 *       <p>Host: {hostType}</p>
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
  const adaptor = getAdaptor();

  // Track availability state (for async adaptor initialization like apps-sdk)
  const [isAvailable, setIsAvailable] = useState(() => adaptor.isAvailable());

  // Use external store for reactive state updates from adaptor
  const subscriptionCount = useSyncExternalStore(
    adaptor.subscribe.bind(adaptor),
    () => {
      // Force re-render on any adaptor state change
      // The actual values are retrieved via adaptor getters below
      return Date.now();
    }
  );

  // Re-check availability after mount (for async script injection in apps-sdk)
  useEffect(() => {
    if (adaptor.isAvailable()) {
      setIsAvailable(true);
      return;
    }

    // Poll for availability (handles async injection)
    const checkInterval = setInterval(() => {
      if (adaptor.isAvailable()) {
        setIsAvailable(true);
        clearInterval(checkInterval);
      }
    }, 100);

    // Cleanup after 5 seconds
    const timeout = setTimeout(() => {
      clearInterval(checkInterval);
    }, 5000);

    return () => {
      clearInterval(checkInterval);
      clearTimeout(timeout);
    };
  }, [adaptor]);

  // Get current state from adaptor (reactive via useSyncExternalStore)
  const toolInput = adaptor.getToolInput<TToolInput>();
  const toolOutput = adaptor.getToolOutput<TOutput>();
  const toolResponseMetadata = adaptor.getToolResponseMetadata<TMetadata>();
  const widgetState = adaptor.getWidgetState<TState>();
  const theme = adaptor.getTheme();
  const displayMode = adaptor.getDisplayMode();
  const safeArea = adaptor.getSafeArea();
  const maxHeight = adaptor.getMaxHeight();
  const userAgent = adaptor.getUserAgent();
  const locale = adaptor.getLocale();

  // Extract widget props from toolResponseMetadata["mcp-use/props"]
  const widgetProps = useMemo(() => {
    if (toolResponseMetadata && typeof toolResponseMetadata === "object") {
      const metaProps = (toolResponseMetadata as Record<string, unknown>)[
        "mcp-use/props"
      ];
      if (metaProps) {
        return metaProps as TProps;
      }
    }
    return defaultProps || ({} as TProps);
  }, [toolResponseMetadata, defaultProps]);

  // Compute MCP server base URL
  const mcp_url = useMemo(() => {
    if (typeof window !== "undefined" && window.__mcpPublicUrl) {
      return window.__mcpPublicUrl.replace(/\/mcp-use\/public$/, "");
    }
    return "";
  }, []);

  // Local widget state with sync to adaptor
  const [localWidgetState, setLocalWidgetState] = useState<TState | null>(null);

  // Sync widget state from adaptor
  useEffect(() => {
    if (widgetState !== undefined && widgetState !== null) {
      setLocalWidgetState(widgetState);
    }
  }, [widgetState]);

  // Stable API methods
  const callTool = useCallback(
    async (
      name: string,
      args: Record<string, unknown>
    ): Promise<CallToolResponse> => {
      return adaptor.callTool(name, args);
    },
    [adaptor]
  );

  const sendFollowUpMessage = useCallback(
    async (prompt: string): Promise<void> => {
      return adaptor.sendMessage(prompt);
    },
    [adaptor]
  );

  const openExternal = useCallback(
    (href: string): void => {
      adaptor.openLink(href);
    },
    [adaptor]
  );

  const requestDisplayMode = useCallback(
    async (mode: DisplayMode): Promise<{ mode: DisplayMode }> => {
      return adaptor.requestDisplayMode(mode);
    },
    [adaptor]
  );

  const setState = useCallback(
    async (
      state: TState | ((prevState: TState | null) => TState)
    ): Promise<void> => {
      const currentState =
        widgetState !== undefined ? widgetState : localWidgetState;
      const newState =
        typeof state === "function" ? state(currentState) : state;

      setLocalWidgetState(newState);
      return adaptor.setWidgetState(newState);
    },
    [adaptor, widgetState, localWidgetState]
  );

  // Determine if tool is still executing
  const isPending = useMemo(() => {
    return isAvailable && toolResponseMetadata === null;
  }, [isAvailable, toolResponseMetadata]);

  // Force re-render dependency (from useSyncExternalStore)
  void subscriptionCount;

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
    isAvailable,
    isPending,

    // Host type
    hostType: adaptor.hostType,
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
  const { state, setState, isAvailable } = useWidget<
    UnknownObject,
    UnknownObject,
    UnknownObject,
    TState
  >();

  // Initialize with default if provided and state is null
  useEffect(() => {
    if (state === null && defaultState !== undefined && isAvailable) {
      setState(defaultState);
    }
  }, []); // Only run once on mount

  return [state, setState] as const;
}

/**
 * Hook to get the current host type
 * @example
 * ```tsx
 * const hostType = useWidgetHostType();
 * if (hostType === 'mcp-app') {
 *   // MCP Apps specific behavior
 * }
 * ```
 */
export function useWidgetHostType(): HostType {
  const { hostType } = useWidget();
  return hostType;
}
