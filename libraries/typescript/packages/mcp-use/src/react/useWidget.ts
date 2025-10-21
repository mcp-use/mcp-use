/**
 * React hook for OpenAI Apps SDK widget development
 * Wraps window.openai API and adapts MCP UI props to toolInput
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type {
  CallToolResponse,
  DisplayMode,
  OpenAiGlobals,
  SafeArea,
  Theme,
  UnknownObject,
  UserAgent,
  UseWidgetResult,
} from './widget-types.js'
import { SET_GLOBALS_EVENT_TYPE } from './widget-types.js'
import type { SetGlobalsEvent } from './widget-types.js'

/**
 * Hook to subscribe to a single value from window.openai globals
 */
function useOpenAiGlobal<K extends keyof OpenAiGlobals>(
  key: K,
): OpenAiGlobals[K] | undefined {
  return useSyncExternalStore(
    (onChange) => {
      const handleSetGlobal = (event: any) => {
        const customEvent = event as SetGlobalsEvent
        const value = customEvent.detail.globals[key]
        if (value === undefined) {
          return
        }
        onChange()
      }

      if (typeof window !== 'undefined') {
        window.addEventListener(
          SET_GLOBALS_EVENT_TYPE,
          handleSetGlobal,
        )
      }

      return () => {
        if (typeof window !== 'undefined') {
          window.removeEventListener(
            SET_GLOBALS_EVENT_TYPE,
            handleSetGlobal,
          )
        }
      }
    },
    () => (typeof window !== 'undefined' && window.openai ? window.openai[key] : undefined),
  )
}

/**
 * React hook for building OpenAI Apps SDK widgets with MCP-use
 * 
 * Provides type-safe access to the window.openai API and automatically
 * maps MCP UI props to the Apps SDK toolInput format.
 * 
 * @example
 * ```tsx
 * const MyWidget: React.FC = () => {
 *   const { props, theme, callTool, sendFollowUpMessage } = useWidget<{
 *     city: string;
 *     temperature: number;
 *   }>();
 * 
 *   return (
 *     <div data-theme={theme}>
 *       <h1>{props.city}</h1>
 *       <p>{props.temperature}°C</p>
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
>(defaultProps?: TProps): UseWidgetResult<TProps, TOutput, TMetadata, TState> {
  // Check if window.openai is available
  const [isAvailable] = useState(() => typeof window !== 'undefined' && !!window.openai)

  // Subscribe to globals
  const toolInput = useOpenAiGlobal('toolInput') as TProps | undefined
  const toolOutput = useOpenAiGlobal('toolOutput') as TOutput | null | undefined
  const toolResponseMetadata = useOpenAiGlobal('toolResponseMetadata') as TMetadata | null | undefined
  const widgetState = useOpenAiGlobal('widgetState') as TState | null | undefined
  const theme = useOpenAiGlobal('theme') as Theme | undefined
  const displayMode = useOpenAiGlobal('displayMode') as DisplayMode | undefined
  const safeArea = useOpenAiGlobal('safeArea') as SafeArea | undefined
  const maxHeight = useOpenAiGlobal('maxHeight') as number | undefined
  const userAgent = useOpenAiGlobal('userAgent') as UserAgent | undefined
  const locale = useOpenAiGlobal('locale') as string | undefined

  // Use local state for widget state with sync to window.openai
  const [localWidgetState, setLocalWidgetState] = useState<TState | null>(null)

  // Sync widget state from window.openai
  useEffect(() => {
    if (widgetState !== undefined) {
      setLocalWidgetState(widgetState)
    }
  }, [widgetState])

  // Stable API methods
  const callTool = useCallback(
    async (name: string, args: Record<string, unknown>): Promise<CallToolResponse> => {
      if (!window.openai?.callTool) {
        throw new Error('window.openai.callTool is not available')
      }
      return window.openai.callTool(name, args)
    },
    [],
  )

  const sendFollowUpMessage = useCallback(async (prompt: string): Promise<void> => {
    if (!window.openai?.sendFollowUpMessage) {
      throw new Error('window.openai.sendFollowUpMessage is not available')
    }
    return window.openai.sendFollowUpMessage({ prompt })
  }, [])

  const openExternal = useCallback((href: string): void => {
    if (!window.openai?.openExternal) {
      throw new Error('window.openai.openExternal is not available')
    }
    window.openai.openExternal({ href })
  }, [])

  const requestDisplayMode = useCallback(
    async (mode: DisplayMode): Promise<{ mode: DisplayMode }> => {
      if (!window.openai?.requestDisplayMode) {
        throw new Error('window.openai.requestDisplayMode is not available')
      }
      return window.openai.requestDisplayMode({ mode })
    },
    [],
  )

  const setState = useCallback(
    async (state: TState | ((prevState: TState | null) => TState)): Promise<void> => {
      const newState = typeof state === 'function' ? state(localWidgetState) : state

      if (!window.openai?.setWidgetState) {
        throw new Error('window.openai.setWidgetState is not available')
      }

      setLocalWidgetState(newState)
      return window.openai.setWidgetState(newState)
    },
    [localWidgetState],
  )

  return {
    // Props and state (with defaults)
    props: (toolInput || defaultProps || {}) as TProps,
    output: (toolOutput ?? null) as TOutput | null,
    metadata: (toolResponseMetadata ?? null) as TMetadata | null,
    state: localWidgetState,
    setState,

    // Layout and theme (with safe defaults)
    theme: theme || 'light',
    displayMode: displayMode || 'inline',
    safeArea: safeArea || { insets: { top: 0, bottom: 0, left: 0, right: 0 } },
    maxHeight: maxHeight || 600,
    userAgent: userAgent || {
      device: { type: 'desktop' },
      capabilities: { hover: true, touch: false },
    },
    locale: locale || 'en',

    // Actions
    callTool,
    sendFollowUpMessage,
    openExternal,
    requestDisplayMode,

    // Availability
    isAvailable,
  }
}

/**
 * Hook to get just the widget props (most common use case)
 * @example
 * ```tsx
 * const props = useWidgetProps<{ city: string; temperature: number }>();
 * ```
 */
export function useWidgetProps<TProps extends UnknownObject = UnknownObject>(
  defaultProps?: TProps,
): TProps {
  const { props } = useWidget<TProps>(defaultProps)
  return props
}

/**
 * Hook to get theme value
 * @example
 * ```tsx
 * const theme = useWidgetTheme();
 * ```
 */
export function useWidgetTheme(): Theme {
  const { theme } = useWidget()
  return theme
}

/**
 * Hook to get and update widget state
 * @example
 * ```tsx
 * const [favorites, setFavorites] = useWidgetState<string[]>([]);
 * ```
 */
export function useWidgetState<TState extends UnknownObject>(
  defaultState?: TState,
): readonly [TState | null, (state: TState | ((prev: TState | null) => TState)) => Promise<void>] {
  const { state, setState } = useWidget<UnknownObject, UnknownObject, UnknownObject, TState>()

  // Initialize with default if provided and state is null
  useEffect(() => {
    if (state === null && defaultState !== undefined && window.openai?.setWidgetState) {
      setState(defaultState)
    }
  }, []) // Only run once on mount

  return [state, setState] as const
}

