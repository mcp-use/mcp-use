import { cn } from "@/client/lib/utils";
import { TerminalIcon, TrashIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  useIframeConsole,
  type ConsoleLogEntry,
} from "../hooks/useIframeConsole";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./ui/sheet";
import { Switch } from "./ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

interface IframeConsoleProps {
  iframeId?: string;
  enabled?: boolean;
}

function LogLevelBadge({ level }: { level: ConsoleLogEntry["level"] }) {
  const colors = {
    log: "bg-zinc-500",
    info: "bg-blue-500",
    warn: "bg-yellow-500",
    error: "bg-red-500",
    debug: "bg-purple-500",
    trace: "bg-gray-500",
  };

  return (
    <span
      className={cn(
        "px-1.5 py-0.5 text-[11px] font-mono font-semibold rounded-full text-white",
        colors[level]
      )}
    >
      {level.toUpperCase()}
    </span>
  );
}

function LogEntry({ log }: { log: ConsoleLogEntry }) {
  const formattedTime = useMemo(() => {
    try {
      const date = new Date(log.timestamp);
      return date.toLocaleTimeString();
    } catch {
      return "";
    }
  }, [log.timestamp]);

  const formatArg = (arg: any): string => {
    if (arg === null) return "null";
    if (arg === undefined) return "undefined";
    if (typeof arg === "string") return arg;
    if (typeof arg === "object") {
      try {
        return JSON.stringify(arg, null, 2);
      } catch {
        return String(arg);
      }
    }
    return String(arg);
  };

  return (
    <div
      className={cn(
        "font-mono text-xs p-2 border-b border-zinc-200 dark:border-zinc-800",
        log.level === "error" && "bg-red-50/30 dark:bg-red-950/10",
        log.level === "warn" && "bg-yellow-50/30 dark:bg-yellow-950/10"
      )}
    >
      <div className="flex items-center gap-2 mb-1">
        <LogLevelBadge level={log.level} />
        <span className="text-zinc-500 dark:text-zinc-400 text-[10px]">
          {formattedTime}
        </span>
        {log.url && (
          <span className="text-zinc-400 dark:text-zinc-500 text-[10px] truncate flex-1">
            {(() => {
              try {
                return new URL(log.url).pathname;
              } catch {
                return log.url;
              }
            })()}
          </span>
        )}
      </div>
      <div className="pl-1">
        {log.args.map((arg, idx) => (
          <pre
            key={idx}
            className={cn(
              "whitespace-pre-wrap break-words",
              log.level === "error" && "text-red-700 dark:text-red-400",
              log.level === "warn" && "text-yellow-700 dark:text-yellow-400"
            )}
          >
            {formatArg(arg)}
          </pre>
        ))}
      </div>
    </div>
  );
}

const PROXY_TOGGLE_KEY = "mcp-inspector-console-proxy-enabled";

export function IframeConsole({
  iframeId,
  enabled = true,
}: IframeConsoleProps) {
  // Load proxy toggle state from localStorage
  const [proxyToPageConsole, setProxyToPageConsole] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      const stored = localStorage.getItem(PROXY_TOGGLE_KEY);
      return stored === "true";
    } catch {
      return true;
    }
  });

  const { logs, clearLogs, isOpen, setIsOpen } = useIframeConsole({
    enabled,
    proxyToPageConsole,
  });
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Save proxy toggle state to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(PROXY_TOGGLE_KEY, String(proxyToPageConsole));
    } catch {
      // Ignore localStorage errors
    }
  }, [proxyToPageConsole]);

  const errorCount = useMemo(
    () => logs.filter((log) => log.level === "error").length,
    [logs]
  );
  const warnCount = useMemo(
    () => logs.filter((log) => log.level === "warn").length,
    [logs]
  );

  // Auto-scroll to bottom when logs change or console opens
  useEffect(() => {
    if (isOpen && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop =
        scrollContainerRef.current.scrollHeight;
    }
  }, [logs, isOpen]);

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="relative bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm shadow-sm hover:bg-white dark:hover:bg-zinc-900"
              onClick={() => setIsOpen(true)}
            >
              <TerminalIcon className="size-4" />
              {(errorCount > 0 || warnCount > 0) && (
                <span
                  className={cn(
                    "ml-2 px-1.5 py-0.5 text-xs rounded-full text-white font-semibold",
                    errorCount > 0 ? "bg-red-500" : "bg-yellow-500"
                  )}
                >
                  {errorCount + warnCount}
                </span>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{errorCount + warnCount} console logs from the iframe</p>
          </TooltipContent>
        </Tooltip>
      </SheetTrigger>
      <SheetContent side="bottom" className="h-[400px] flex flex-col p-0">
        <SheetHeader className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center justify-between">
            <SheetTitle className="flex items-center gap-2">
              <TerminalIcon className="size-4" />
              Widget Console Logs
              {logs.length > 0 && (
                <span className="text-sm font-normal text-zinc-500 dark:text-zinc-400">
                  ({logs.length} {logs.length === 1 ? "log" : "logs"})
                </span>
              )}
            </SheetTitle>
            <div className="flex items-center gap-4 pr-4">
              <div className="flex items-center gap-2">
                <Switch
                  id="proxy-console-toggle"
                  checked={proxyToPageConsole}
                  onCheckedChange={setProxyToPageConsole}
                />
                <Label
                  htmlFor="proxy-console-toggle"
                  className="text-sm font-normal cursor-pointer"
                >
                  Proxy logs to page console
                </Label>
              </div>
              {logs.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearLogs}
                  className="-my-2"
                >
                  <TrashIcon className="size-4 mr-1" />
                  Clear
                </Button>
              )}
            </div>
          </div>
        </SheetHeader>
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-auto bg-zinc-50 dark:bg-zinc-950"
        >
          {logs.length === 0 ? (
            <div className="flex items-center justify-center h-full text-zinc-500 dark:text-zinc-400">
              <div className="text-center">
                <TerminalIcon className="size-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No console logs yet</p>
                <p className="text-xs mt-1">
                  Logs from iframes will appear here
                </p>
              </div>
            </div>
          ) : (
            <div>
              {logs.map((log) => (
                <LogEntry key={log.id} log={log} />
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
