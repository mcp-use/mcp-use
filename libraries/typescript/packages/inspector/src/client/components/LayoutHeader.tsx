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
import type { MCPConnection } from "@/client/context/McpContext";
import { cn } from "@/client/lib/utils";
import {
  Bell,
  Check,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Command,
  Copy,
  FolderOpen,
  Hash,
  MessageCircle,
  MessageSquare,
  Wrench,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AnimatedThemeToggler } from "./AnimatedThemeToggler";
import LogoAnimated from "./LogoAnimated";
import { ServerDropdown } from "./ServerDropdown";

interface LayoutHeaderProps {
  connections: MCPConnection[];
  selectedServer: MCPConnection | undefined;
  activeTab: string;
  onServerSelect: (serverId: string) => void;
  onTabChange: (tab: TabType) => void;
  onCommandPaletteOpen: () => void;
  onOpenConnectionOptions: (connectionId: string | null) => void;
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

export function LayoutHeader({
  connections,
  selectedServer,
  activeTab,
  onServerSelect,
  onTabChange,
  onCommandPaletteOpen,
  onOpenConnectionOptions,
}: LayoutHeaderProps) {
  const { tunnelUrl } = useInspector();
  const showTunnelBadge = selectedServer && tunnelUrl;
  const [copied, setCopied] = useState(false);

  const [collapsed, setCollapsed] = useState(false);

  const handleCopy = async () => {
    if (!tunnelUrl) return;

    try {
      await navigator.clipboard.writeText(`${tunnelUrl}/mcp`);
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
          {/* Left: Server Selector (Icon + Chevron) */}
          <div className="flex-1 flex justify-start">
            <ServerDropdown
              connections={connections}
              selectedServer={selectedServer}
              onServerSelect={onServerSelect}
              onOpenConnectionOptions={onOpenConnectionOptions}
              mobileMode={true}
            />
          </div>

          {/* Middle: Logo (centered, no text) */}
          <div className="flex-shrink-0 flex justify-center">
            <div className="scale-150">
              <LogoAnimated state="collapsed" />
            </div>
          </div>

          {/* Right: GitHub and Theme Icons */}
          <div className="flex-1 flex justify-end items-center gap-2">
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
            <AnimatedThemeToggler className="p-2 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-full transition-colors cursor-pointer" />
          </div>
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
                {tabs.map((tab) => {
                  const count = getTabCount(tab.id, selectedServer);

                  return (
                    <TabsTrigger
                      key={tab.id}
                      value={tab.id}
                      icon={tab.icon}
                      className={cn(
                        "[&>svg]:mr-0 flex-1 flex-row gap-2 relative",
                        collapsed && "pl-2"
                      )}
                    >
                      {count > 0 && (
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
          {/* Server Selection Dropdown */}
          <ServerDropdown
            connections={connections}
            selectedServer={selectedServer}
            onServerSelect={onServerSelect}
            onOpenConnectionOptions={onOpenConnectionOptions}
          />

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
                  {tabs.map((tab) => {
                    const count = getTabCount(tab.id, selectedServer);
                    const tooltipText =
                      count > 0 ? `${tab.label} (${count})` : tab.label;

                    return (
                      <TabsTrigger
                        value={tab.id}
                        icon={tab.icon}
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

          {/* Tunnel Badge */}
          {showTunnelBadge && (
            <Popover>
              <PopoverTrigger asChild>
                <button className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-purple-500/10 to-pink-500/10 dark:from-purple-500/20 dark:to-pink-500/20 border border-purple-500/30 dark:border-purple-500/40 rounded-full hover:from-purple-500/20 hover:to-pink-500/20 dark:hover:from-purple-500/30 dark:hover:to-pink-500/30 transition-colors cursor-pointer">
                  <Zap className="size-4 text-purple-600 dark:text-purple-400 animate-pulse" />
                  <span className="text-xs font-medium text-purple-700 dark:text-purple-300 hidden lg:inline">
                    Tunnel
                  </span>
                </button>
              </PopoverTrigger>
              <PopoverContent
                className="w-[calc(100vw-2rem)] sm:w-96"
                align="start"
              >
                <div className="space-y-4">
                  <div>
                    <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                      <Zap className="size-4 text-purple-600 dark:text-purple-400" />
                      Tunnel URL
                    </h4>
                    <div className="flex items-center gap-2 p-2 py-0 bg-muted rounded-full">
                      <code className="flex-1 text-[10px] font-mono">
                        {tunnelUrl}
                        /mcp
                      </code>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={handleCopy}
                      >
                        {copied ? (
                          <Check className="size-3.5 text-green-600" />
                        ) : (
                          <Copy className="size-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>

                  <div>
                    <h5 className="font-semibold text-sm mb-2">
                      Use in ChatGPT
                    </h5>
                    <ol className="space-y-2 text-xs text-muted-foreground">
                      <li className="flex gap-2">
                        <span className="font-semibold text-foreground">
                          1.
                        </span>
                        <span>
                          Enable{" "}
                          <span className="font-medium text-foreground">
                            dev mode
                          </span>{" "}
                          from settings
                        </span>
                      </li>
                      <li className="flex gap-2">
                        <span className="font-semibold text-foreground">
                          2.
                        </span>
                        <span>
                          In{" "}
                          <span className="font-medium text-foreground">
                            App & Connectors
                          </span>{" "}
                          click on{" "}
                          <span className="font-medium text-foreground">
                            create
                          </span>
                        </span>
                      </li>
                      <li className="flex gap-2">
                        <span className="font-semibold text-foreground">
                          3.
                        </span>
                        <span>Use the tunnel URL in the input</span>
                      </li>
                    </ol>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>

        {/* Right side: Theme Toggle + Command Palette + GitHub Button + Logo */}
        <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
          <Tooltip>
            <TooltipTrigger>
              <AnimatedThemeToggler className="p-2 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-full transition-colors cursor-pointer" />
            </TooltipTrigger>
            <TooltipContent>
              <p>Toggle theme</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                className="hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-full px-1 -mx-3 flex gap-1"
                onClick={onCommandPaletteOpen}
              >
                <Command className="size-4" />
                <span className="text-base font-mono hidden sm:inline">K</span>
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
                  <span className="hidden sm:inline">Github</span>
                </a>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Give us a star ⭐</p>
            </TooltipContent>
          </Tooltip>

          <LogoAnimated state="expanded" />
        </div>
      </div>
    </header>
  );
}
