import { useCallback, useEffect, useRef, useState } from "react";

export interface ConsoleLogEntry {
  id: string;
  level: "log" | "error" | "warn" | "info" | "debug" | "trace";
  args: any[];
  timestamp: string;
  url?: string;
}

interface UseIframeConsoleOptions {
  enabled?: boolean;
  maxLogs?: number;
  proxyToPageConsole?: boolean;
}

/**
 * Hook to manage console logs from iframes
 */
export function useIframeConsole(options: UseIframeConsoleOptions = {}) {
  const {
    enabled = true,
    maxLogs = 1000,
    proxyToPageConsole = false,
  } = options;
  const [logs, setLogs] = useState<ConsoleLogEntry[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const logIdCounterRef = useRef(0);

  const addLog = useCallback(
    (entry: Omit<ConsoleLogEntry, "id">) => {
      if (!enabled) return;

      const newLog: ConsoleLogEntry = {
        ...entry,
        id: `log-${++logIdCounterRef.current}-${Date.now()}`,
      };

      setLogs((prevLogs) => {
        const updated = [...prevLogs, newLog];
        // Keep only the most recent logs
        return updated.slice(-maxLogs);
      });

      // Proxy to page console if enabled
      if (proxyToPageConsole) {
        const prefix = "[WIDGET CONSOLE]";

        // Format arguments for console output
        const formattedArgs = entry.args.map((arg) => {
          if (typeof arg === "object" && arg !== null) {
            try {
              return JSON.stringify(arg, null, 2);
            } catch {
              return String(arg);
            }
          }
          return arg;
        });

        // Use appropriate console method based on level
        switch (entry.level) {
          case "error":
            console.error(prefix, ...formattedArgs);
            break;
          case "warn":
            console.warn(prefix, ...formattedArgs);
            break;
          case "info":
            console.info(prefix, ...formattedArgs);
            break;
          case "debug":
            console.debug(prefix, ...formattedArgs);
            break;
          case "trace":
            console.trace(prefix, ...formattedArgs);
            break;
          default:
            console.log(prefix, ...formattedArgs);
        }
      }
    },
    [enabled, maxLogs, proxyToPageConsole]
  );

  const clearLogs = useCallback(() => {
    setLogs([]);
    logIdCounterRef.current = 0;
  }, []);

  // Listen for console log messages from iframes
  useEffect(() => {
    if (!enabled) return;

    const handleMessage = (event: MessageEvent) => {
      // Verify message structure
      if (
        event.data &&
        event.data.type === "iframe-console-log" &&
        event.data.level &&
        Array.isArray(event.data.args)
      ) {
        addLog({
          level: event.data.level,
          args: event.data.args,
          timestamp: event.data.timestamp || new Date().toISOString(),
          url: event.data.url,
        });
      }
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [enabled, addLog]);

  return {
    logs,
    addLog,
    clearLogs,
    isOpen,
    setIsOpen,
  };
}
