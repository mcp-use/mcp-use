/**
 * Widget Debug Context
 *
 * Manages debugging state for MCP Apps and ChatGPT Apps widgets.
 * Tracks CSP violations, widget state, host context, and playground settings.
 *
 * Follows the same React Context pattern as InspectorContext (not Zustand).
 */

import type { ReactNode } from "react";
import { createContext, use, useCallback, useState } from "react";

export type WidgetProtocol = "mcp-apps" | "chatgpt-app" | "mcp-ui";

export interface CspViolation {
  directive: string;
  effectiveDirective: string;
  blockedUri: string;
  sourceFile?: string;
  lineNumber?: number;
  columnNumber?: number;
  timestamp: number;
}

export interface WidgetInfo {
  toolName: string;
  protocol: WidgetProtocol;
  hostContext?: any;
  cspViolations: CspViolation[];
  modelContext?: {
    content?: any[];
    structuredContent?: Record<string, unknown>;
  };
  widgetState?: any;
}

export interface PlaygroundSettings {
  deviceType: "mobile" | "tablet" | "desktop" | "custom";
  customViewport: { width: number; height: number };
  cspMode: "permissive" | "widget-declared";
  displayModeOverride: "inline" | "pip" | "fullscreen" | null;
  capabilities: { hover: boolean; touch: boolean };
  safeAreaInsets: { top: number; right: number; bottom: number; left: number };
  locale: string;
  timeZone: string;
}

interface WidgetDebugState {
  activeWidgetId: string | null;
  widgets: Map<string, WidgetInfo>;
  playground: PlaygroundSettings;
}

interface WidgetDebugContextType extends WidgetDebugState {
  setActiveWidget: (widgetId: string | null) => void;
  addWidget: (
    widgetId: string,
    info: Omit<WidgetInfo, "cspViolations">
  ) => void;
  removeWidget: (widgetId: string) => void;
  getWidget: (widgetId: string) => WidgetInfo | undefined;
  addCspViolation: (widgetId: string, violation: CspViolation) => void;
  clearCspViolations: (widgetId: string) => void;
  setWidgetModelContext: (
    widgetId: string,
    context: WidgetInfo["modelContext"]
  ) => void;
  setWidgetState: (widgetId: string, state: any) => void;
  updatePlaygroundSettings: (settings: Partial<PlaygroundSettings>) => void;
  clearAllWidgets: () => void;
}

const WidgetDebugContext = createContext<WidgetDebugContextType | undefined>(
  undefined
);

const DEFAULT_PLAYGROUND_SETTINGS: PlaygroundSettings = {
  deviceType: "desktop",
  customViewport: { width: 768, height: 1024 },
  cspMode: "permissive",
  displayModeOverride: null,
  capabilities: { hover: true, touch: false },
  safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
  locale: "en-US",
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
};

/**
 * Provider for widget debugging context
 *
 * Manages widget debug state following the same pattern as InspectorProvider
 */
export function WidgetDebugProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WidgetDebugState>({
    activeWidgetId: null,
    widgets: new Map(),
    playground: DEFAULT_PLAYGROUND_SETTINGS,
  });

  const setActiveWidget = useCallback((widgetId: string | null) => {
    setState((prev) => ({ ...prev, activeWidgetId: widgetId }));
  }, []);

  const addWidget = useCallback(
    (widgetId: string, info: Omit<WidgetInfo, "cspViolations">) => {
      setState((prev) => {
        const newWidgets = new Map(prev.widgets);
        newWidgets.set(widgetId, {
          ...info,
          cspViolations: [],
        });
        return { ...prev, widgets: newWidgets };
      });
    },
    []
  );

  const removeWidget = useCallback((widgetId: string) => {
    setState((prev) => {
      const newWidgets = new Map(prev.widgets);
      newWidgets.delete(widgetId);
      return {
        ...prev,
        widgets: newWidgets,
        activeWidgetId:
          prev.activeWidgetId === widgetId ? null : prev.activeWidgetId,
      };
    });
  }, []);

  const getWidget = useCallback(
    (widgetId: string): WidgetInfo | undefined => {
      return state.widgets.get(widgetId);
    },
    [state.widgets]
  );

  const addCspViolation = useCallback(
    (widgetId: string, violation: CspViolation) => {
      setState((prev) => {
        const widget = prev.widgets.get(widgetId);
        if (!widget) return prev;

        const newWidgets = new Map(prev.widgets);
        newWidgets.set(widgetId, {
          ...widget,
          cspViolations: [...widget.cspViolations, violation],
        });
        return { ...prev, widgets: newWidgets };
      });
    },
    []
  );

  const clearCspViolations = useCallback((widgetId: string) => {
    setState((prev) => {
      const widget = prev.widgets.get(widgetId);
      if (!widget) return prev;

      const newWidgets = new Map(prev.widgets);
      newWidgets.set(widgetId, {
        ...widget,
        cspViolations: [],
      });
      return { ...prev, widgets: newWidgets };
    });
  }, []);

  const setWidgetModelContext = useCallback(
    (widgetId: string, context: WidgetInfo["modelContext"]) => {
      setState((prev) => {
        const widget = prev.widgets.get(widgetId);
        if (!widget) return prev;

        const newWidgets = new Map(prev.widgets);
        newWidgets.set(widgetId, {
          ...widget,
          modelContext: context,
        });
        return { ...prev, widgets: newWidgets };
      });
    },
    []
  );

  const setWidgetState = useCallback((widgetId: string, widgetState: any) => {
    setState((prev) => {
      const widget = prev.widgets.get(widgetId);
      if (!widget) return prev;

      const newWidgets = new Map(prev.widgets);
      newWidgets.set(widgetId, {
        ...widget,
        widgetState,
      });
      return { ...prev, widgets: newWidgets };
    });
  }, []);

  const updatePlaygroundSettings = useCallback(
    (settings: Partial<PlaygroundSettings>) => {
      setState((prev) => ({
        ...prev,
        playground: {
          ...prev.playground,
          ...settings,
        },
      }));
    },
    []
  );

  const clearAllWidgets = useCallback(() => {
    setState((prev) => ({
      ...prev,
      widgets: new Map(),
      activeWidgetId: null,
    }));
  }, []);

  const value: WidgetDebugContextType = {
    ...state,
    setActiveWidget,
    addWidget,
    removeWidget,
    getWidget,
    addCspViolation,
    clearCspViolations,
    setWidgetModelContext,
    setWidgetState,
    updatePlaygroundSettings,
    clearAllWidgets,
  };

  return <WidgetDebugContext value={value}>{children}</WidgetDebugContext>;
}

/**
 * Hook to access widget debug context
 *
 * @throws Error if used outside of WidgetDebugProvider
 */
export function useWidgetDebug() {
  const context = use(WidgetDebugContext);
  if (!context) {
    throw new Error("useWidgetDebug must be used within WidgetDebugProvider");
  }
  return context;
}

/**
 * Device viewport configurations for common devices
 */
export const DEVICE_VIEWPORT_CONFIGS = {
  mobile: { width: 390, height: 844, name: "iPhone 14" },
  tablet: { width: 820, height: 1180, name: "iPad Air" },
  desktop: { width: 1440, height: 900, name: "Desktop" },
  custom: { width: 768, height: 1024, name: "Custom" },
} as const;

/**
 * Safe area presets for common devices
 */
export const SAFE_AREA_PRESETS = {
  none: { top: 0, right: 0, bottom: 0, left: 0, name: "None" },
  iphone_notch: {
    top: 47,
    right: 0,
    bottom: 34,
    left: 0,
    name: "iPhone Notch",
  },
  iphone_island: {
    top: 59,
    right: 0,
    bottom: 34,
    left: 0,
    name: "Dynamic Island",
  },
  android_gesture: {
    top: 24,
    right: 0,
    bottom: 48,
    left: 0,
    name: "Android Gesture",
  },
} as const;
