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
  Bell,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Command,
  Copy,
  FolderOpen,
  Hash,
  MessageCircle,
  MessageSquare,
  Plus,
  Wrench,
  Zap,
} from "lucide-react";
import type { McpServer } from "mcp-use/react";
import { useState } from "react";
import { toast } from "sonner";
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
  const { tunnelUrl } = useInspector();
  const showTunnelBadge = selectedServer && tunnelUrl;
  const [copied, setCopied] = useState(false);
  const [tsSdkModalOpen, setTsSdkModalOpen] = useState(false);
  const [pySdkModalOpen, setPySdkModalOpen] = useState(false);

  const [collapsed, setCollapsed] = useState(true);

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
                {tabs.map((tab) => {
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
                  {tabs.map((tab) => {
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

        {/* Right side: Add to Client + Theme Toggle + Command Palette + GitHub Button + Logo - Hidden in embedded mode */}
        {!embedded && (
          <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
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
