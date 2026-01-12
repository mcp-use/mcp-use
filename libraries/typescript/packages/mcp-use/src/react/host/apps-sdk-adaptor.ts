/**
 * Apps SDK Adaptor
 *
 * Adaptor for OpenAI Apps SDK (window.openai) host environment.
 * Used when widgets run inside ChatGPT with the Apps SDK injected.
 *
 * Communication Pattern:
 * 1. ChatGPT injects window.openai API
 * 2. Widget detects window.openai availability
 * 3. Widget subscribes to openai:set_globals events
 * 4. Tool executes -> globals update -> widget re-renders
 * 5. Widget calls window.openai methods for actions
 */

import type {
  CallToolResponse,
  DisplayMode,
  SafeArea,
  Theme,
  UserAgent,
} from "../widget-types.js";
import { SET_GLOBALS_EVENT_TYPE } from "../widget-types.js";
import type { WidgetHostAdaptor, HostType } from "./types.js";

export class AppsSdkAdaptor implements WidgetHostAdaptor {
  readonly hostType: HostType = "apps-sdk";

  isAvailable(): boolean {
    return typeof window !== "undefined" && !!window.openai;
  }

  // ─────────────────────────────────────────────────────────────────
  // State Access
  // ─────────────────────────────────────────────────────────────────

  getToolInput<T>(): T | undefined {
    return window.openai?.toolInput as T | undefined;
  }

  getToolOutput<T>(): T | null {
    return (window.openai?.toolOutput as T | null) ?? null;
  }

  getToolResponseMetadata<T>(): T | null {
    return (window.openai?.toolResponseMetadata as T | null) ?? null;
  }

  getWidgetState<T>(): T | null {
    return (window.openai?.widgetState as T | null) ?? null;
  }

  getTheme(): Theme {
    return window.openai?.theme ?? "light";
  }

  getDisplayMode(): DisplayMode {
    return window.openai?.displayMode ?? "inline";
  }

  getLocale(): string {
    return window.openai?.locale ?? "en";
  }

  getMaxHeight(): number {
    return window.openai?.maxHeight ?? 600;
  }

  getSafeArea(): SafeArea {
    return (
      window.openai?.safeArea ?? {
        insets: { top: 0, bottom: 0, left: 0, right: 0 },
      }
    );
  }

  getUserAgent(): UserAgent {
    return (
      window.openai?.userAgent ?? {
        device: { type: "desktop" },
        capabilities: { hover: true, touch: false },
      }
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // Actions
  // ─────────────────────────────────────────────────────────────────

  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<CallToolResponse> {
    if (!window.openai?.callTool) {
      throw new Error("window.openai.callTool is not available");
    }
    return window.openai.callTool(name, args);
  }

  async sendMessage(message: string): Promise<void> {
    if (!window.openai?.sendFollowUpMessage) {
      throw new Error("window.openai.sendFollowUpMessage is not available");
    }
    return window.openai.sendFollowUpMessage({ prompt: message });
  }

  openLink(href: string): void {
    if (!window.openai?.openExternal) {
      throw new Error("window.openai.openExternal is not available");
    }
    window.openai.openExternal({ href });
  }

  async requestDisplayMode(
    mode: DisplayMode
  ): Promise<{ mode: DisplayMode }> {
    if (!window.openai?.requestDisplayMode) {
      throw new Error("window.openai.requestDisplayMode is not available");
    }
    return window.openai.requestDisplayMode({ mode });
  }

  async setWidgetState<T>(state: T): Promise<void> {
    if (!window.openai?.setWidgetState) {
      throw new Error("window.openai.setWidgetState is not available");
    }
    return window.openai.setWidgetState(state);
  }

  async notifyHeight(height: number): Promise<void> {
    if (!window.openai?.notifyIntrinsicHeight) {
      throw new Error("window.openai.notifyIntrinsicHeight is not available");
    }
    return window.openai.notifyIntrinsicHeight(height);
  }

  // ─────────────────────────────────────────────────────────────────
  // Subscriptions
  // ─────────────────────────────────────────────────────────────────

  subscribe(callback: () => void): () => void {
    const handler = () => {
      callback();
    };

    if (typeof window !== "undefined") {
      window.addEventListener(SET_GLOBALS_EVENT_TYPE, handler);
    }

    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener(SET_GLOBALS_EVENT_TYPE, handler);
      }
    };
  }
}
