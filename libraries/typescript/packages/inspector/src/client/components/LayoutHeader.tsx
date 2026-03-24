import { Button } from "@/client/components/ui/button";
import { GithubIcon } from "@/client/components/ui/github-icon";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/client/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import type { TabType } from "@/client/context/InspectorContext";
import { useInspector } from "@/client/context/InspectorContext";
import { cn } from "@/client/lib/utils";
import {
  ArrowUpRight,
  Bell,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Command,
  Copy,
  FolderOpen,
  ChevronsLeftRightEllipsis,
  Hash,
  Loader2,
  MessageCircle,
  MessageSquare,
  Plus,
  Square,
  Wrench,
} from "lucide-react";
import { INSPECTOR_RECONNECT_STORAGE_KEY } from "@/client/hooks/useAutoConnect";
import type { McpServer } from "mcp-use/react";
import { useEffect, useState } from "react";

import { toast } from "sonner";
import { copyToClipboard } from "@/client/utils/clipboard";
import { AddToClientDropdown } from "./AddToClientDropdown";
import LogoAnimated from "./LogoAnimated";
import { SdkIntegrationModal } from "./SdkIntegrationModal";
import { ServerDropdown } from "./ServerDropdown";
import { ThemeToggle } from "./ThemeToggle";

// Type alias for backward compatibility
type MCPConnection = McpServer;

interface LayoutHeaderProps {
  connections: MCPConnection[];
  selectedServer: MCPConnection | undefined;
  activeTab: string;
  onServerSelect: (serverId: string) => void;
  onTabChange: (tab: TabType) => void;
  onCommandPaletteOpen: () => void;
  onOpenConnectionOptions: (connectionId: string | null) => void;
  embedded?: boolean;
}

const tabs = [
  { id: "tools", label: "Tools", icon: Wrench },
  { id: "prompts", label: "Prompts", icon: MessageSquare },
  { id: "resources", label: "Resources", icon: FolderOpen },
  { id: "sampling", label: "Sampling", icon: Hash },
  { id: "elicitation", label: "Elicitation", icon: CheckSquare },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "chat", label: "Chat", icon: MessageCircle },
];

function getTabCount(tabId: string, server: MCPConnection): number {
  if (tabId === "tools") {
    return server.tools.length;
  } else if (tabId === "prompts") {
    return server.prompts.length;
  } else if (tabId === "resources") {
    return server.resources.length;
  } else if (tabId === "sampling") {
    return server.pendingSamplingRequests?.length || 0;
  } else if (tabId === "elicitation") {
    return server.pendingElicitationRequests?.length || 0;
  } else if (tabId === "notifications") {
    return server.unreadNotificationCount;
  }
  return 0;
}

function shouldShowDot(
  tabId: string,
  count: number,
  collapsed: boolean
): boolean {
  const dotTabs = ["sampling", "elicitation", "notifications"];
  return collapsed && count > 0 && dotTabs.includes(tabId);
}

function CollapseButton({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onToggle}
          className={cn(
            "shrink-0 p-1.5 rounded-md transition-all duration-500 ease-in-out cursor-pointer",
            "text-muted-foreground hover:text-foreground",
            "hover:bg-zinc-100 dark:hover:bg-zinc-800",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          )}
          aria-label={collapsed ? "Expand tabs" : "Collapse tabs"}
          type="button"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4 transition-transform duration-500 ease-in-out" />
          ) : (
            <ChevronLeft className="h-4 w-4 transition-transform duration-500 ease-in-out" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{collapsed ? "Expand tabs" : "Collapse tabs"}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function isLocalhostServerUrl(serverUrl: string): boolean {
  try {
    const u = new URL(serverUrl);
    const h = u.hostname.toLowerCase();
    return (
      h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "0.0.0.0"
    );
  } catch {
    return false;
  }
}

function isMcpUseTunnelUrl(serverUrl: string): boolean {
  try {
    return new URL(serverUrl).hostname.endsWith(".mcp-use.run");
  } catch {
    return false;
  }
}

function tunnelOriginFromMcpUrl(mcpUrl: string | null): string | null {
  if (!mcpUrl) return null;
  try {
    const u = new URL(mcpUrl);
    if (u.protocol === "https:") {
      return u.origin;
    }
  } catch {
    /* ignore */
  }
  return null;
}

const TUNNEL_PHASE = {
  starting: "Starting tunnel…",
  stopping: "Stopping tunnel…",
  reconnecting: "Reconnecting…",
} as const;

function TunnelBadge({
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
        const res = await fetch("/inspector/api/dev/info");
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
    const infoUrl = `http://localhost:${port}/inspector/api/dev/info`;
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
                connectionType: "Direct",
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
    try {
      const res = await fetch("/inspector/api/dev/start-tunnel", {
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
    } catch {
      toast.error("Failed to start tunnel");
      setIsTunnelStarting(false);
    }
  };

  const handleStopTunnel = async () => {
    setTunnelPhaseMessage(TUNNEL_PHASE.stopping);
    setIsTunnelStarting(true);
    try {
      const res = await fetch("/inspector/api/dev/stop-tunnel", {
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
    } catch {
      toast.error("Failed to stop tunnel");
      setIsTunnelStarting(false);
    }
  };

  if (isTunnelStarting) {
    return (
      <button
        disabled
        className="flex items-center gap-2 h-9 px-3 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-full opacity-75 cursor-wait"
      >
        <Loader2 className="size-4 text-zinc-500 dark:text-zinc-400 animate-spin" />
        <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300 hidden lg:inline">
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
            ? "bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-700 cursor-pointer"
            : "bg-zinc-100/60 dark:bg-zinc-800/60 border-zinc-200 dark:border-zinc-700 cursor-not-allowed opacity-70"
        )}
      >
        {loadingDev ? (
          <Loader2 className="size-4 text-zinc-500 dark:text-zinc-400 animate-spin" />
        ) : (
          <ChevronsLeftRightEllipsis className="size-4 text-zinc-500 dark:text-zinc-400" />
        )}
        <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300 hidden lg:inline">
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

/**
 * Renders the application header with server selector, tabs, tunnel badge, and global actions.
 *
 * Renders responsive mobile and desktop layouts showing the server dropdown, collapsible tabs with counts,
 * tunnel URL popover and copy action, Add to Client dropdown with SDK integration modals, theme toggle,
 * command palette trigger, GitHub link, and branding. Elements that depend on a selected server or the
 * `embedded` prop are conditionally hidden.
 *
 * @param connections - Available server connections shown in the server dropdown.
 * @param selectedServer - Currently selected server; used to populate server-specific UI and counts.
 * @param activeTab - Currently active tab id.
 * @param onServerSelect - Callback invoked with the selected server id.
 * @param onTabChange - Callback invoked when the active tab changes.
 * @param onCommandPaletteOpen - Callback invoked to open the command palette.
 * @param onOpenConnectionOptions - Callback invoked to open connection options; receives a connection id or `null`.
 * @param embedded - When true, hide non-essential header chrome for embedded contexts.
 * @returns The header element containing responsive navigation and server controls.
 */
export function LayoutHeader({
  connections,
  selectedServer,
  activeTab,
  onServerSelect,
  onTabChange,
  onCommandPaletteOpen,
  onOpenConnectionOptions,
  embedded = false,
}: LayoutHeaderProps) {
  const {
    tunnelUrl,
    isTunnelStarting,
    setTunnelUrl,
    setIsTunnelStarting,
    embeddedConfig,
  } = useInspector();
  const showTunnelBadge =
    !!selectedServer &&
    (isLocalhostServerUrl(selectedServer.url) ||
      isMcpUseTunnelUrl(selectedServer.url) ||
      !!tunnelUrl);
  const [copied, setCopied] = useState(false);
  const [tsSdkModalOpen, setTsSdkModalOpen] = useState(false);
  const [pySdkModalOpen, setPySdkModalOpen] = useState(false);

  const [collapsed, setCollapsed] = useState(true);

  // In single-tab mode, hide the entire header
  if (embeddedConfig.singleTab) {
    return null;
  }

  // Filter tabs based on visibleTabs config
  const filteredTabs = embeddedConfig.visibleTabs
    ? tabs.filter((t) => embeddedConfig.visibleTabs!.includes(t.id as TabType))
    : tabs;

  const handleCopy = async () => {
    if (!tunnelUrl) return;

    try {
      await copyToClipboard(`${tunnelUrl}/mcp`);
      setCopied(true);
      toast.success("Tunnel URL copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy URL");
    }
  };

  return (
    <header className="w-full mx-auto">
      {/* Mobile Layout */}
      <div className="flex lg:hidden flex-col gap-3">
        <div className="flex items-center justify-between w-full">
          {/* Left: Server Selector (Icon + Chevron) - Hidden in embedded mode */}
          {!embedded && (
            <div className="flex-1 flex justify-start">
              <ServerDropdown
                connections={connections}
                selectedServer={selectedServer}
                onServerSelect={onServerSelect}
                onOpenConnectionOptions={onOpenConnectionOptions}
                mobileMode={true}
              />
            </div>
          )}

          {/* Middle: Logo (centered, no text) - Hidden in embedded mode */}
          {!embedded && (
            <div className="flex-shrink-0 flex justify-center">
              <div className="scale-150">
                <LogoAnimated state="collapsed" />
              </div>
            </div>
          )}

          {/* Right: GitHub and Theme Icons - Hidden in embedded mode */}
          {!embedded && (
            <div className="flex-1 flex justify-end items-center gap-2">
              {selectedServer &&
                (() => {
                  // Extract display name the same way ServerDropdown does
                  const displayName =
                    selectedServer.serverInfo?.title ||
                    selectedServer.serverInfo?.name ||
                    selectedServer.name;
                  return (
                    <>
                      <AddToClientDropdown
                        serverConfig={{
                          url: tunnelUrl
                            ? `${tunnelUrl}/mcp`
                            : selectedServer.url,
                          name: displayName,
                          headers: (selectedServer as any).customHeaders,
                          serverId: selectedServer.id,
                        }}
                        onSuccess={(client: string) =>
                          toast.success(`Opening in ${client}...`)
                        }
                        onError={(error: Error) =>
                          toast.error(`Failed: ${error.message}`)
                        }
                        additionalItems={[
                          {
                            id: "ts-sdk",
                            label: "TypeScript SDK",
                            icon: (
                              <img
                                src="https://cdn.simpleicons.org/typescript"
                                alt="TypeScript"
                                className="h-4 w-4"
                              />
                            ),
                            onClick: () => setTsSdkModalOpen(true),
                          },
                          {
                            id: "py-sdk",
                            label: "Python SDK",
                            icon: (
                              <img
                                src="https://cdn.simpleicons.org/python"
                                alt="Python"
                                className="h-4 w-4"
                              />
                            ),
                            onClick: () => setPySdkModalOpen(true),
                          },
                        ]}
                        trigger={
                          <Button
                            variant="ghost"
                            className="bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 rounded-full transition-colors px-3 flex items-center justify-center p-2"
                            aria-label="Add to Client"
                          >
                            <span className="xl:hidden hidden sm:flex items-center gap-1">
                              <Plus className="size-3" />
                              Client
                            </span>
                            <span className="hidden xl:flex items-center gap-1">
                              Add to Client
                              <ChevronDown className="size-3" />
                            </span>
                          </Button>
                        }
                      />
                      <SdkIntegrationModal
                        open={tsSdkModalOpen}
                        onOpenChange={setTsSdkModalOpen}
                        serverUrl={
                          tunnelUrl ? `${tunnelUrl}/mcp` : selectedServer.url
                        }
                        serverName={displayName}
                        serverId={undefined}
                        headers={(selectedServer as any).customHeaders}
                        language="typescript"
                      />
                      <SdkIntegrationModal
                        open={pySdkModalOpen}
                        onOpenChange={setPySdkModalOpen}
                        serverUrl={
                          tunnelUrl ? `${tunnelUrl}/mcp` : selectedServer.url
                        }
                        serverName={displayName}
                        serverId={undefined}
                        headers={(selectedServer as any).customHeaders}
                        language="python"
                      />
                    </>
                  );
                })()}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" asChild>
                    <a
                      href="https://github.com/mcp-use/mcp-use"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2"
                      aria-label="GitHub"
                    >
                      <GithubIcon className="h-4 w-4" />
                    </a>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Give us a star ⭐</p>
                </TooltipContent>
              </Tooltip>
              <ThemeToggle />
            </div>
          )}
        </div>

        {/* Mobile Tabs - Icons Only */}
        {selectedServer && (
          <div className="w-full">
            <Tabs
              value={activeTab}
              onValueChange={(tab) => onTabChange(tab as TabType)}
              collapsed={collapsed}
              onCollapsedChange={setCollapsed}
            >
              <TabsList className="w-full justify-center">
                {filteredTabs.map((tab) => {
                  const count = getTabCount(tab.id, selectedServer);
                  const showDot = shouldShowDot(tab.id, count, collapsed);

                  return (
                    <TabsTrigger
                      key={tab.id}
                      value={tab.id}
                      data-testid={`tab-${tab.id}`}
                      icon={tab.icon}
                      showDot={showDot}
                      className={cn(
                        "[&>svg]:mr-0 flex-1 flex-row gap-2 relative",
                        collapsed && "pl-2"
                      )}
                    >
                      {count > 0 && !collapsed && (
                        <span
                          className={cn(
                            activeTab === tab.id
                              ? "dark:bg-black"
                              : "dark:bg-zinc-700",
                            "bg-zinc-200 text-zinc-700 dark:text-zinc-300 text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                          )}
                        >
                          {count}
                        </span>
                      )}
                      <span className="sr-only">{tab.label}</span>
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </Tabs>
          </div>
        )}
      </div>

      {/* Desktop Layout */}
      <div className="hidden lg:flex items-center justify-between gap-3">
        {/* Left side: Server dropdown + Tabs + Tunnel Badge */}
        <div className="flex items-center flex-wrap gap-2 md:space-x-6 space-x-2">
          {/* Server Selection Dropdown - Hidden in embedded mode */}
          {!embedded && (
            <ServerDropdown
              connections={connections}
              selectedServer={selectedServer}
              onServerSelect={onServerSelect}
              onOpenConnectionOptions={onOpenConnectionOptions}
            />
          )}

          {/* Tabs */}
          {selectedServer && (
            <div className="flex items-center gap-2">
              <Tabs
                value={activeTab}
                onValueChange={(tab) => onTabChange(tab as TabType)}
                collapsed={collapsed}
                onCollapsedChange={setCollapsed}
              >
                <TabsList className="overflow-x-auto" collapsible>
                  {filteredTabs.map((tab) => {
                    const count = getTabCount(tab.id, selectedServer);
                    const tooltipText =
                      count > 0 ? `${tab.label} (${count})` : tab.label;
                    const showDot = shouldShowDot(tab.id, count, collapsed);

                    return (
                      <TabsTrigger
                        value={tab.id}
                        data-testid={`tab-${tab.id}`}
                        icon={tab.icon}
                        showDot={showDot}
                        className={cn(
                          "[&>svg]:mr-0 lg:[&>svg]:mr-2 relative",
                          collapsed && "pl-4"
                        )}
                        title={tooltipText}
                      >
                        <div className="items-center gap-2 hidden lg:flex">
                          {tab.label}
                          {count > 0 && (
                            <span
                              className={cn(
                                activeTab === tab.id
                                  ? " dark:bg-black "
                                  : "dark:bg-zinc-700",
                                "bg-zinc-200 text-zinc-700 dark:text-zinc-300 text-xs px-2 py-0.5 rounded-full font-medium"
                              )}
                            >
                              {count}
                            </span>
                          )}
                        </div>
                      </TabsTrigger>
                    );
                  })}
                </TabsList>
              </Tabs>
              <CollapseButton
                collapsed={collapsed}
                onToggle={() => setCollapsed(!collapsed)}
              />
            </div>
          )}
        </div>

        {/* Right side: Tunnel Badge + Add to Client + Theme Toggle + Command Palette + GitHub Button + Logo - Hidden in embedded mode */}
        {!embedded && (
          <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
            {/* Tunnel Badge */}
            {showTunnelBadge && (
              <TunnelBadge
                tunnelUrl={tunnelUrl}
                isTunnelStarting={isTunnelStarting}
                setTunnelUrl={setTunnelUrl}
                setIsTunnelStarting={setIsTunnelStarting}
                copied={copied}
                setCopied={setCopied}
                handleCopy={handleCopy}
              />
            )}
            {selectedServer &&
              (() => {
                // Extract display name the same way ServerDropdown does
                const displayName =
                  selectedServer.serverInfo?.title ||
                  selectedServer.serverInfo?.name ||
                  selectedServer.name;
                return (
                  <>
                    <AddToClientDropdown
                      serverConfig={{
                        url: tunnelUrl
                          ? `${tunnelUrl}/mcp`
                          : selectedServer.url,
                        name: displayName,
                        headers: (selectedServer as any).customHeaders,
                        serverId: selectedServer.id,
                      }}
                      onSuccess={(client: string) =>
                        toast.success(`Opening in ${client}...`)
                      }
                      onError={(error: Error) =>
                        toast.error(`Failed: ${error.message}`)
                      }
                      additionalItems={[
                        {
                          id: "ts-sdk",
                          label: "TypeScript SDK",
                          icon: (
                            <img
                              src="https://cdn.simpleicons.org/typescript"
                              alt="TypeScript"
                              className="h-4 w-4"
                            />
                          ),
                          onClick: () => setTsSdkModalOpen(true),
                        },
                        {
                          id: "py-sdk",
                          label: "Python SDK",
                          icon: (
                            <img
                              src="https://cdn.simpleicons.org/python"
                              alt="Python"
                              className="h-4 w-4"
                            />
                          ),
                          onClick: () => setPySdkModalOpen(true),
                        },
                      ]}
                      trigger={
                        <Button
                          variant="ghost"
                          className="bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 rounded-full transition-colors px-3 flex items-center justify-center"
                          aria-label="Add to Client"
                        >
                          <span className="xl:hidden hidden sm:flex items-center gap-1">
                            <Plus className="size-3" />
                            Client
                          </span>
                          <span className="hidden xl:flex items-center gap-1">
                            Add to Client
                            <ChevronDown className="size-3" />
                          </span>
                        </Button>
                      }
                    />
                    <SdkIntegrationModal
                      open={tsSdkModalOpen}
                      onOpenChange={setTsSdkModalOpen}
                      serverUrl={
                        tunnelUrl ? `${tunnelUrl}/mcp` : selectedServer.url
                      }
                      serverName={displayName}
                      serverId={undefined}
                      headers={(selectedServer as any).customHeaders}
                      language="typescript"
                    />
                    <SdkIntegrationModal
                      open={pySdkModalOpen}
                      onOpenChange={setPySdkModalOpen}
                      serverUrl={
                        tunnelUrl ? `${tunnelUrl}/mcp` : selectedServer.url
                      }
                      serverName={displayName}
                      serverId={undefined}
                      headers={(selectedServer as any).customHeaders}
                      language="python"
                    />
                  </>
                );
              })()}
            <ThemeToggle />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  className="hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-full px-1 -mx-3 flex gap-1"
                  onClick={onCommandPaletteOpen}
                  data-testid="command-palette-trigger-button"
                >
                  <Command className="size-4" />
                  <span className="text-base font-mono hidden sm:inline">
                    K
                  </span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Command Palette</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" asChild>
                  <a
                    href="https://github.com/mcp-use/mcp-use"
                    className="flex items-center gap-2"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <GithubIcon className="h-4 w-4" />
                    <span className="hidden xl:inline">Github</span>
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Give us a star ⭐</p>
              </TooltipContent>
            </Tooltip>

            <LogoAnimated state="expanded" />
          </div>
        )}
      </div>
    </header>
  );
}
