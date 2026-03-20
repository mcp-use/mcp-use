/**
 * Console Log Bus - Event bus for widget console logs
 *
 * This provides a way to publish and subscribe to console logs
 * without using window.postMessage (which can interfere with
 * browser extensions like React DevTools).
 */

import type { ConsoleLogEntry } from "./hooks/useIframeConsole";

type ConsoleLogEventCallback = (entry: Omit<ConsoleLogEntry, "id">) => void;

class ConsoleLogBus {
  private listeners = new Set<ConsoleLogEventCallback>();

  /**
   * Publish a console log entry to all subscribers
   */
  publish(entry: Omit<ConsoleLogEntry, "id">): void {
    this.listeners.forEach((listener) => {
      try {
        listener(entry);
      } catch (e) {
        console.error("[ConsoleLogBus] Error in listener:", e);
      }
    });
  }

  /**
   * Subscribe to console log events
   * @returns Unsubscribe function
   */
  subscribe(listener: ConsoleLogEventCallback): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const consoleLogBus = new ConsoleLogBus();
