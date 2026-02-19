import { cn } from "@/client/lib/utils";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Search,
  TerminalIcon,
  TrashIcon,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
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

type FilterLevel = "all" | ConsoleLogEntry["level"];

const MIN_HEIGHT = 200;
const MAX_HEIGHT_RATIO = 0.9;

function formatArg(arg: unknown): string {
  if (arg === null) return "null";
  if (arg === undefined) return "undefined";
  if (typeof arg === "string") return arg;
  if (typeof arg === "object") {
    try {
      return JSON.stringify(arg, null, 2);
    } catch {
      return String(arg as object);
    }
  }
  return String(arg);
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
        "px-1.5 py-0.5 text-[11px] font-mono font-semibold rounded-full text-white shrink-0",
        colors[level]
      )}
    >
      {level.toUpperCase()}
    </span>
  );
}

function LogEntry({ log }: { log: ConsoleLogEntry }) {
  const [expanded, setExpanded] = useState(false);

  const formattedTime = useMemo(() => {
    try {
      const date = new Date(log.timestamp);
      return date.toLocaleTimeString();
    } catch {
      return "";
    }
  }, [log.timestamp]);

  const inlinePreview = useMemo(() => {
    if (log.args.length === 0) return "";
    const first = formatArg(log.args[0]);
    const singleLine = first.replace(/\s*\n\s*/g, " ").trim();
    const truncated =
      singleLine.length > 120 ? singleLine.slice(0, 120) + "…" : singleLine;
    const extra = log.args.length > 1 ? ` +${log.args.length - 1}` : "";
    return truncated + extra;
  }, [log.args]);

  const copyLog = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const text = log.args.map(formatArg).join("\n");
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Failed to copy");
    }
  };

  const rowColor = cn(
    "font-mono text-xs border-b border-zinc-200 dark:border-zinc-800",
    log.level === "error" && "bg-red-50/30 dark:bg-red-950/10",
    log.level === "warn" && "bg-yellow-50/30 dark:bg-yellow-950/10"
  );

  const headerHover = cn(
    "cursor-pointer select-none",
    log.level === "error" && "hover:bg-red-50/50 dark:hover:bg-red-950/20",
    log.level === "warn" && "hover:bg-yellow-50/50 dark:hover:bg-yellow-950/20",
    log.level !== "error" &&
      log.level !== "warn" &&
      "hover:bg-zinc-100/70 dark:hover:bg-zinc-800/40"
  );

  return (
    <div className={cn(rowColor, "group")}>
      {/* Clickable header row */}
      <div
        className={cn("flex items-center gap-2 px-2 py-1.5", headerHover)}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="text-zinc-400 dark:text-zinc-500 shrink-0">
          {expanded ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
        </span>
        <LogLevelBadge level={log.level} />
        <span className="text-zinc-500 dark:text-zinc-400 text-[10px] shrink-0">
          {formattedTime}
        </span>
        {!expanded && (
          <span
            className={cn(
              "truncate text-[11px]",
              log.level === "error" && "text-red-700 dark:text-red-400",
              log.level === "warn" && "text-yellow-700 dark:text-yellow-400",
              log.level !== "error" &&
                log.level !== "warn" &&
                "text-zinc-700 dark:text-zinc-300"
            )}
          >
            {inlinePreview}
          </span>
        )}
        {expanded && log.url && (
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
        {expanded && (
          <button
            onClick={copyLog}
            aria-label="Copy log"
            className="ml-auto shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            <Copy className="size-3" />
          </button>
        )}
      </div>

      {/* Expanded body — text is selectable, clicks don't collapse */}
      {expanded && (
        <div className="pl-8 pr-2 pb-2 select-text">
          {log.args.map((arg, idx) => (
            <pre
              key={idx}
              className={cn(
                "whitespace-pre-wrap wrap-break-word text-[11px]",
                log.level === "error" && "text-red-700 dark:text-red-400",
                log.level === "warn" && "text-yellow-700 dark:text-yellow-400",
                log.level !== "error" &&
                  log.level !== "warn" &&
                  "text-zinc-700 dark:text-zinc-300"
              )}
            >
              {formatArg(arg)}
            </pre>
          ))}
        </div>
      )}
    </div>
  );
}

const PROXY_TOGGLE_KEY = "mcp-inspector-console-proxy-enabled";
const CONSOLE_HEIGHT_KEY = "mcp-inspector-console-height";

const LEVELS: ConsoleLogEntry["level"][] = [
  "log",
  "info",
  "warn",
  "error",
  "debug",
  "trace",
];

const levelFilterColors: Record<ConsoleLogEntry["level"], string> = {
  log: "text-zinc-500",
  info: "text-blue-500",
  warn: "text-yellow-500",
  error: "text-red-500",
  debug: "text-purple-500",
  trace: "text-gray-500",
};

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

  // Resizable height state
  const [height, setHeight] = useState(() => {
    if (typeof window === "undefined") return 400;
    try {
      const stored = localStorage.getItem(CONSOLE_HEIGHT_KEY);
      return stored ? Math.max(MIN_HEIGHT, parseInt(stored, 10)) : 400;
    } catch {
      return 400;
    }
  });
  const isDragging = useRef(false);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      const maxHeight = Math.floor(window.innerHeight * MAX_HEIGHT_RATIO);
      const newHeight = Math.min(
        maxHeight,
        Math.max(MIN_HEIGHT, window.innerHeight - ev.clientY)
      );
      setHeight(newHeight);
    };

    const onMouseUp = () => {
      isDragging.current = false;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, []);

  // Persist height to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(CONSOLE_HEIGHT_KEY, String(height));
    } catch {
      // ignore
    }
  }, [height]);

  // Filter state
  const [activeFilter, setActiveFilter] = useState<FilterLevel>("all");
  const [searchQuery, setSearchQuery] = useState("");

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

  const levelCounts = useMemo(() => {
    const counts: Record<ConsoleLogEntry["level"], number> = {
      log: 0,
      info: 0,
      warn: 0,
      error: 0,
      debug: 0,
      trace: 0,
    };
    for (const log of logs) counts[log.level]++;
    return counts;
  }, [logs]);

  const errorCount = levelCounts.error;
  const warnCount = levelCounts.warn;
  const infoCount =
    levelCounts.log + levelCounts.info + levelCounts.debug + levelCounts.trace;

  const totalCount = logs.length;

  const badgeColor = useMemo(() => {
    if (errorCount > 0) return "bg-red-500";
    if (warnCount > 0) return "bg-yellow-500";
    if (infoCount > 0) return "bg-zinc-500";
    return "bg-zinc-500";
  }, [errorCount, warnCount, infoCount]);

  const filteredLogs = useMemo(() => {
    let result =
      activeFilter === "all"
        ? logs
        : logs.filter((l) => l.level === activeFilter);
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter((log) => {
        const argsText = log.args.map(formatArg).join(" ").toLowerCase();
        const urlText = (log.url ?? "").toLowerCase();
        return argsText.includes(q) || urlText.includes(q);
      });
    }
    return result;
  }, [logs, activeFilter, searchQuery]);

  // Auto-scroll to bottom when logs change or console opens (skip when searching)
  useEffect(() => {
    if (isOpen && !searchQuery && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop =
        scrollContainerRef.current.scrollHeight;
    }
  }, [filteredLogs, isOpen, searchQuery]);

  // Copy all logs to clipboard
  const copyAllLogs = async () => {
    try {
      const formattedLogs = filteredLogs
        .map((log) => {
          const timestamp = new Date(log.timestamp).toLocaleTimeString();
          const level = log.level.toUpperCase();
          const url = log.url ? ` ${log.url}` : "";
          const args = log.args.map(formatArg).join("\n");
          return `[${level}] ${timestamp}${url}\n${args}`;
        })
        .join("\n\n");

      await navigator.clipboard.writeText(formattedLogs);
      toast.success(`Copied ${filteredLogs.length} logs to clipboard`);
    } catch {
      toast.error("Failed to copy logs to clipboard");
    }
  };

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
              {totalCount > 0 && (
                <span
                  className={cn(
                    "ml-2 px-1.5 py-0.5 text-xs rounded-full text-white font-semibold",
                    badgeColor
                  )}
                >
                  {totalCount}
                </span>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <div className="text-xs space-y-1">
              <p className="font-semibold">
                {totalCount} console {totalCount === 1 ? "log" : "logs"}
              </p>
              {errorCount > 0 && (
                <p className="text-red-400">
                  {errorCount} error{errorCount !== 1 ? "s" : ""}
                </p>
              )}
              {warnCount > 0 && (
                <p className="text-yellow-400">
                  {warnCount} warning{warnCount !== 1 ? "s" : ""}
                </p>
              )}
              {infoCount > 0 && (
                <p className="text-zinc-400">{infoCount} info</p>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </SheetTrigger>
      <SheetContent
        side="bottom"
        className="flex flex-col p-0 transition-none m-0 gap-0"
        style={{ height }}
      >
        {/* Resize handle */}
        <div
          className="h-1.5 w-full shrink-0 cursor-ns-resize bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors"
          onMouseDown={handleResizeMouseDown}
        />

        <SheetHeader className="px-4 py-4 m-0 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
          {/* Title row */}
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
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={copyAllLogs}
                    className="-my-2"
                  >
                    <Copy className="size-4 mr-1" />
                    Copy All
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearLogs}
                    className="-my-2"
                  >
                    <TrashIcon className="size-4 mr-1" />
                    Clear
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Filter + search row */}
          <div className="flex items-center gap-1 pt-1">
            <button
              onClick={() => setActiveFilter("all")}
              className={cn(
                "px-2 py-0.5 text-xs rounded font-medium transition-colors",
                activeFilter === "all"
                  ? "bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100"
                  : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              )}
            >
              All
              {totalCount > 0 && (
                <span className="ml-1 text-[10px] opacity-70">
                  {totalCount}
                </span>
              )}
            </button>
            {LEVELS.map((level) => {
              const count = levelCounts[level];
              return (
                <button
                  key={level}
                  onClick={() =>
                    setActiveFilter(activeFilter === level ? "all" : level)
                  }
                  className={cn(
                    "px-2 py-0.5 text-xs rounded font-medium transition-colors",
                    activeFilter === level
                      ? "bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100"
                      : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  )}
                >
                  <span className={cn(count > 0 && levelFilterColors[level])}>
                    {level.charAt(0).toUpperCase() + level.slice(1)}
                  </span>
                  {count > 0 && (
                    <span
                      className={cn(
                        "ml-1 text-[10px]",
                        levelFilterColors[level]
                      )}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}

            {/* Search input — pushed to the right */}
            <div className="ml-auto flex items-center gap-1 relative">
              <Search className="absolute left-2 size-3 text-zinc-400 dark:text-zinc-500 pointer-events-none" />
              <input
                type="text"
                placeholder="Filter logs…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-6 pr-6 py-0.5 text-xs rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:focus:ring-zinc-500 w-44"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  aria-label="Clear search"
                  className="absolute right-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          </div>
        </SheetHeader>

        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-auto bg-zinc-50 dark:bg-zinc-950"
        >
          {filteredLogs.length === 0 ? (
            <div className="flex items-center justify-center h-full text-zinc-500 dark:text-zinc-400">
              <div className="text-center">
                <TerminalIcon className="size-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">
                  {logs.length === 0
                    ? "No console logs yet"
                    : searchQuery
                      ? `No logs match "${searchQuery}"`
                      : "No logs match the current filter"}
                </p>
                <p className="text-xs mt-1">
                  {logs.length === 0
                    ? "Logs from iframes will appear here"
                    : `${logs.length} log${logs.length !== 1 ? "s" : ""} hidden by filter`}
                </p>
              </div>
            </div>
          ) : (
            <div>
              {filteredLogs.map((log) => (
                <LogEntry key={log.id} log={log} />
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
