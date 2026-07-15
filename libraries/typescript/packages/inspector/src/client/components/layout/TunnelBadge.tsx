import { cn } from "@/client/lib/utils";
import { inspectorApi } from "@/client/utils/basePath";
import { INSPECTOR_RECONNECT_STORAGE_KEY } from "@/client/hooks/useAutoConnect";
import { MCPTunnelActionEvent, captureInspectorEvent } from "@/client/telemetry";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import {
  ArrowUpRight,
  Check,
  ChevronsLeftRightEllipsis,
  Copy,
  Loader2,
  Square,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { tunnelOriginFromMcpUrl } from "./layoutHeaderUtils";

export const TUNNEL_PHASE = {
  starting: "Starting tunnel…",
  stopping: "Stopping tunnel…",
  reconnecting: "Reconnecting…",
} as const;




export function TunnelBadge({
  tunnelUrl,
  isTunnelStarting,
  setTunnelUrl,
  setIsTunnelStarting,
  copied,
  setCopied,
  handleCopy,
}: {
  tunnelUrl: string | null;
  isTunnelStarting: boolean;
  setTunnelUrl: (url: string | null) => void;
  setIsTunnelStarting: (starting: boolean) => void;
  copied: boolean;
  setCopied: (copied: boolean) => void;
  handleCopy: () => void;
}) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [devFromCli, setDevFromCli] = useState<boolean | null>(null);
  const [waitTicks, setWaitTicks] = useState(0);
  const [_, setTunnelPhaseMessage] = useState<string>(TUNNEL_PHASE.starting);

  useEffect(() => {
    if (!isTunnelStarting) {
      setWaitTicks(20);
      return;
    }
    setWaitTicks(20);
    const id = setInterval(
      () => setWaitTicks((t) => (t > 0 ? t - 1 : 0)),
      1000
    );
    return () => clearInterval(id);
  }, [isTunnelStarting]);

  useEffect(() => {
    if (!tunnelUrl) return;
    setPopoverOpen(true);
    // Clean up the query param if present
    const p = new URLSearchParams(window.location.search);
    if (p.has("openTunnelPopover")) {
      p.delete("openTunnelPopover");
      const qs = p.toString();
      window.history.replaceState(
        {},
        "",
        `${window.location.pathname}${qs ? `?${qs}` : ""}`
      );
    }
  }, [tunnelUrl]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(inspectorApi("dev/info"));
        if (!res.ok || cancelled) return;
        const info = (await res.json()) as {
          fromCli?: boolean;
          tunnelUrl?: string | null;
          mcpUrl?: string | null;
        };
        if (cancelled) return;
        setDevFromCli(!!info.fromCli);
        if (info.tunnelUrl) {
          setTunnelUrl(new URL(info.tunnelUrl).origin);
        } else {
          const origin = tunnelOriginFromMcpUrl(info.mcpUrl ?? null);
          if (origin) setTunnelUrl(origin);
        }
      } catch {
        if (!cancelled) setDevFromCli(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setTunnelUrl]);

  /**
   * Poll /inspector/api/dev/info until the new server is ready,
   * then redirect the inspector to reconnect via sessionStorage.
   */
  const pollAndReconnect = async (expectTunnel: boolean) => {
    const port = window.location.port || "3000";
    const infoUrl = `http://localhost:${port}${inspectorApi("dev/info")}`;
    const deadline = Date.now() + 90_000;

    setTunnelPhaseMessage(
      expectTunnel ? "Restarting with tunnel…" : "Restarting…"
    );

    // Wait a moment for the old process to exit
    await new Promise((r) => setTimeout(r, 1500));

    while (Date.now() < deadline) {
      try {
        const r = await fetch(infoUrl, { cache: "no-store" });
        if (r.ok) {
          const info = (await r.json()) as {
            mcpUrl?: string;
            tunnelUrl?: string;
          };
          const hasTunnel = !!info.tunnelUrl;
          if (hasTunnel === expectTunnel) {
            const baseUrl =
              info.tunnelUrl || info.mcpUrl || `http://localhost:${port}`;
            const mcpEndpoint = baseUrl.replace(/\/+$/, "") + "/mcp";

            if (info.tunnelUrl) {
              setTunnelUrl(new URL(info.tunnelUrl).origin);
            } else {
              setTunnelUrl(null);
            }

            sessionStorage.setItem(
              INSPECTOR_RECONNECT_STORAGE_KEY,
              JSON.stringify({
                url: mcpEndpoint,
                name: "Local MCP Server",
                transportType: "http",
                connectionMode: "auto",
              })
            );
            toast.success(
              expectTunnel
                ? "Tunnel ready — reconnecting…"
                : "Tunnel stopped — reconnecting…"
            );
            setTunnelPhaseMessage(TUNNEL_PHASE.reconnecting);

            const u = new URL(window.location.href);
            u.searchParams.delete("server");
            u.searchParams.delete("tunnelUrl");
            u.searchParams.delete("autoConnect");
            if (expectTunnel) u.searchParams.set("openTunnelPopover", "1");
            window.location.assign(u.toString());
            return;
          }
        }
      } catch {
        // Server not up yet — keep polling
      }
      await new Promise((r) => setTimeout(r, 1500));
    }

    toast.error("Timeout waiting for server to restart");
    setIsTunnelStarting(false);
  };

  const handleStartTunnel = async () => {
    if (devFromCli === false) {
      toast.error(
        "Start Tunnel requires `mcp-use dev` from your project directory."
      );
      return;
    }
    setTunnelPhaseMessage(TUNNEL_PHASE.starting);
    setIsTunnelStarting(true);
    let success = false;
    try {
      const res = await fetch(inspectorApi("dev/start-tunnel"), {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error((data as any).error || "Failed to start tunnel");
        setIsTunnelStarting(false);
        return;
      }
      // Server is restarting — poll until the new instance with tunnel is up
      await pollAndReconnect(true);
      success = true;
    } catch {
      toast.error("Failed to start tunnel");
      setIsTunnelStarting(false);
    }
    try {
      captureInspectorEvent(new MCPTunnelActionEvent({ action: "start", success }))
        .catch(() => {});
    } catch {
      // ignore telemetry errors
    }
  };

  const handleStopTunnel = async () => {
    setTunnelPhaseMessage(TUNNEL_PHASE.stopping);
    setIsTunnelStarting(true);
    let success = false;
    try {
      const res = await fetch(inspectorApi("dev/stop-tunnel"), {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error((data as any).error || "Failed to stop tunnel");
        setIsTunnelStarting(false);
        return;
      }
      setCopied(false);
      setPopoverOpen(false);
      // Server is restarting — poll until the new instance without tunnel is up
      await pollAndReconnect(false);
      success = true;
    } catch {
      toast.error("Failed to stop tunnel");
      setIsTunnelStarting(false);
    }
    try {
      captureInspectorEvent(
          new MCPTunnelActionEvent({
            action: "stop",
            success,
            tunnelUrl: tunnelUrl,
          })
        )
        .catch(() => {});
    } catch {
      // ignore telemetry errors
    }
  };

  if (isTunnelStarting) {
    return (
      <button
        disabled
        className="flex items-center gap-2 h-9 px-3 bg-violet-50 dark:bg-violet-950/40 border border-violet-200 dark:border-violet-800 rounded-full opacity-75 cursor-wait"
      >
        <Loader2 className="size-4 text-violet-500 dark:text-violet-400 animate-spin" />
        <span className="text-sm font-medium text-violet-600 dark:text-violet-300 hidden lg:inline">
          Start Tunnel <span className="tabular-nums">{waitTicks}s</span>
        </span>
      </button>
    );
  }

  if (!tunnelUrl) {
    const canStart = devFromCli === true;
    const loadingDev = devFromCli === null;
    return (
      <button
        type="button"
        onClick={handleStartTunnel}
        disabled={!canStart || loadingDev}
        title={
          devFromCli === false
            ? "Run `mcp-use dev` from your project to enable tunneling."
            : loadingDev
              ? "Checking dev server…"
              : undefined
        }
        className={cn(
          "flex items-center gap-2 h-9 px-3 border rounded-full transition-colors",
          canStart && !loadingDev
            ? "bg-violet-50 dark:bg-violet-950/40 border-violet-200 dark:border-violet-800 hover:bg-violet-100 dark:hover:bg-violet-900/50 cursor-pointer"
            : "bg-violet-50/60 dark:bg-violet-950/20 border-violet-200 dark:border-violet-800 cursor-not-allowed opacity-70"
        )}
      >
        {loadingDev ? (
          <Loader2 className="size-4 text-violet-500 dark:text-violet-400 animate-spin" />
        ) : (
          <ChevronsLeftRightEllipsis className="size-4 text-violet-500 dark:text-violet-400" />
        )}
        <span className="text-sm font-medium text-violet-600 dark:text-violet-300 hidden lg:inline">
          Start Tunnel
        </span>
      </button>
    );
  }

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-2 h-9 px-3 bg-gradient-to-r from-purple-500/10 to-pink-500/10 dark:from-purple-500/20 dark:to-pink-500/20 border border-purple-500/30 dark:border-purple-500/40 rounded-full hover:from-purple-500/20 hover:to-pink-500/20 dark:hover:from-purple-500/30 dark:hover:to-pink-500/30 transition-colors cursor-pointer">
          <ChevronsLeftRightEllipsis className="size-4 text-purple-600 dark:text-purple-400" />
          <span className="text-sm font-medium text-purple-700 dark:text-purple-300 hidden lg:inline">
            Tunnel
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[calc(100vw-2rem)] sm:w-96 overflow-hidden"
        align="end"
      >
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold text-sm">Tunnel URL</h4>
              <a
                href="https://manufact.com/docs/tunneling"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Docs
                <ArrowUpRight className="size-3" />
              </a>
            </div>
            <button
              onClick={handleCopy}
              className="-mx-4 px-4 py-3 bg-muted hover:bg-accent transition-colors cursor-pointer flex items-center gap-3 w-[calc(100%+2rem)]"
            >
              <code className="flex-1 text-[10px] font-mono truncate text-left">
                {tunnelUrl}/mcp
              </code>
              {copied ? (
                <Check className="size-3.5 text-green-600 shrink-0" />
              ) : (
                <Copy className="size-3.5 shrink-0 text-muted-foreground" />
              )}
            </button>
          </div>

          <div>
            <h5 className="font-semibold text-sm mb-2">Use in ChatGPT</h5>
            <ol className="space-y-2 text-xs text-muted-foreground">
              <li className="flex gap-2">
                <span className="font-semibold text-foreground">1.</span>
                <span>
                  Enable{" "}
                  <span className="font-medium text-foreground">dev mode</span>{" "}
                  from settings
                </span>
              </li>
              <li className="flex gap-2">
                <span className="font-semibold text-foreground">2.</span>
                <span>
                  In{" "}
                  <span className="font-medium text-foreground">
                    App & Connectors
                  </span>{" "}
                  click on{" "}
                  <span className="font-medium text-foreground">create</span>
                </span>
              </li>
              <li className="flex gap-2">
                <span className="font-semibold text-foreground">3.</span>
                <span>Use the tunnel URL in the input</span>
              </li>
            </ol>
          </div>

          <button
            onClick={handleStopTunnel}
            className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors cursor-pointer"
          >
            <Square className="size-3 fill-current" />
            Stop Tunnel
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
