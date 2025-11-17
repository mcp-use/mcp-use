import { useCallback, useEffect, useRef, useState } from 'react';

export interface ConsoleLogEntry {
  id: string;
  level: 'log' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  args: any[];
  timestamp: string;
  url?: string;
}

interface UseIframeConsoleOptions {
  enabled?: boolean;
  maxLogs?: number;
}

/**
 * Hook to manage console logs from iframes
 */
export function useIframeConsole(options: UseIframeConsoleOptions = {}) {
  const { enabled = true, maxLogs = 1000 } = options;
  const [logs, setLogs] = useState<ConsoleLogEntry[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const logIdCounterRef = useRef(0);

  const addLog = useCallback(
    (entry: Omit<ConsoleLogEntry, 'id'>) => {
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
    },
    [enabled, maxLogs]
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
        event.data.type === 'iframe-console-log' &&
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

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
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
