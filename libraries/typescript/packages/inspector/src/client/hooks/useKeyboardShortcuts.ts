import { useEffect } from "react";

export interface KeyboardShortcutHandlers {
  onToolsTab?: () => void;
  onPromptsTab?: () => void;
  onResourcesTab?: () => void;
  onChatTab?: () => void;
  onHome?: () => void;
  onFocusSearch?: () => void;
  onBlurSearch?: () => void;
  onCommandPalette?: () => void;
  onNewChat?: () => void;
}

/**
 * Centralized keyboard shortcuts hook for the Inspector app
 *
 * Shortcuts:
 * - Cmd/Ctrl + K: Open command palette
 * - Cmd/Ctrl + O: Start a new chat
 * - t: Switch to tools tab (when no input focused)
 * - p: Switch to prompts tab (when no input focused)
 * - r: Switch to resources tab (when no input focused)
 * - c: Switch to chat tab (when no input focused)
 * - h: Go to home (when no input focused)
 * - f: Focus search bar on tools/prompts/resources tabs (when no input focused)
 * - Escape: Close command palette / blur focused element
 */
export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers) {
  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      // Check if any input, textarea, or contenteditable element is focused
      const target = event.target as HTMLElement;
      const isInputFocused =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.contentEditable === "true";

      // Cmd/Ctrl + K for command palette (works even with inputs focused)
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        handlers.onCommandPalette?.();
        return;
      }

      // Cmd/Ctrl + O for new chat (only if handler is registered)
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key === "o" &&
        handlers.onNewChat
      ) {
        event.preventDefault();
        handlers.onNewChat();
        return;
      }

      // Escape key handling (works with inputs focused to blur them)
      if (event.key === "Escape") {
        event.preventDefault();
        // Blur the currently focused element
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        handlers.onBlurSearch?.();
        return;
      }

      // Don't handle other shortcuts if an input is focused
      if (isInputFocused) {
        return;
      }

      // Don't handle shortcuts if any modifier keys are pressed
      // This prevents conflicts with browser shortcuts like Cmd+R
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
      }

      // Single key shortcuts (only when no input is focused and no modifiers)
      switch (event.key.toLowerCase()) {
        case "t":
          event.preventDefault();
          handlers.onToolsTab?.();
          break;
        case "p":
          event.preventDefault();
          handlers.onPromptsTab?.();
          break;
        case "r":
          event.preventDefault();
          handlers.onResourcesTab?.();
          break;
        case "c":
          event.preventDefault();
          handlers.onChatTab?.();
          break;
        case "h":
          event.preventDefault();
          handlers.onHome?.();
          break;
        case "f":
          event.preventDefault();
          handlers.onFocusSearch?.();
          break;
        default:
          // No action for other keys
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handlers]);
}
