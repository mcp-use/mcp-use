import { Button } from "@/client/components/ui/button";
import { GithubIcon } from "@/client/components/ui/github-icon";
import { Tabs, TabsList, TabsTrigger } from "@/client/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import type { TabType } from "@/client/context/InspectorContext";
import { useInspector } from "@/client/context/InspectorContext";
import { cn } from "@/client/lib/utils";
import { isLocalhostServerUrl } from "@/client/utils/servers";
import {
  Bell,
  Bug,
  CheckSquare,
  ChevronDown,
  Command,
  FolderOpen,
  Hash,
  MessageCircle,
  MessageSquare,
  Monitor,
  Moon,
  Plus,
  Rocket,
  Settings,
  SunDim,
  Wrench,
} from "lucide-react";
import type { McpServer } from "@mcp-use/client/react";
import { useState } from "react";

import { toast } from "sonner";
import { HostedUserMenu } from "@/client/components/HostedUserMenu";
import { getServerDisplayName } from "@/client/utils/servers";
import { getServerHeaders } from "@/client/utils/connectionUpdates";
import { copyToClipboard } from "@/client/utils/browser";
import { useTheme } from "@/client/context/ThemeContext";
import {
  MCPDeployClickEvent,
  captureInspectorEvent,
} from "@/client/telemetry";
import { TabCountBadge } from "./shared/TabCountBadge";
import { AddToClientDropdown } from "./AddToClientDropdown";
import LogoAnimated from "./LogoAnimated";
import { SdkIntegrationModal } from "./SdkIntegrationModal";
import { ServerDropdown } from "./ServerDropdown";
import { TunnelBadge } from "./layout/TunnelBadge";
import { CollapseButton } from "./layout/CollapseButton";
import { getTabCount, isMcpUseTunnelUrl, shouldShowDot } from "./layout/layoutHeaderUtils";

interface LayoutHeaderProps {
  connections: McpServer[];
  selectedServer: McpServer | undefined;
  activeTab: string;
  onServerSelect: (serverId: string) => void;
  onTabChange: (tab: TabType) => void;
  onCommandPaletteOpen: () => void;
  onOpenConnectionOptions: (connectionId: string | null) => void;
  embedded?: boolean;
}

const tabs = [
  { id: "chat", label: "Chat", icon: MessageCircle, alwaysExpanded: true },
  { id: "separator" },
  { id: "tools", label: "Tools", icon: Wrench },
  { id: "prompts", label: "Prompts", icon: MessageSquare },
  { id: "resources", label: "Resources", icon: FolderOpen },
  { id: "sampling", label: "Sampling", icon: Hash },
  { id: "elicitation", label: "Elicitation", icon: CheckSquare },
  { id: "notifications", label: "Notifications", icon: Bell },
] as const;


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
  const { theme, setTheme } = useTheme();
  const showTunnelBadge =
    !!selectedServer &&
    (isLocalhostServerUrl(selectedServer.url ?? "") ||
      isMcpUseTunnelUrl(selectedServer.url ?? "") ||
      !!tunnelUrl);
  const [copied, setCopied] = useState(false);
  const [tsSdkModalOpen, setTsSdkModalOpen] = useState(false);
  const [pySdkModalOpen, setPySdkModalOpen] = useState(false);

  const [collapsed, setCollapsed] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // In single-tab mode, hide the entire header
  if (embeddedConfig.singleTab) {
    return null;
  }

  // Filter tabs based on visibleTabs config
  const filteredTabs = embeddedConfig.visibleTabs
    ? tabs.filter(
        (t) =>
          t.id === "separator" ||
          embeddedConfig.visibleTabs!.includes(t.id as TabType)
      )
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
                  const displayName = getServerDisplayName(selectedServer);
                  return (
                    <>
                      <AddToClientDropdown
                        serverConfig={{
                          url: tunnelUrl
                            ? `${tunnelUrl}/mcp`
                            : selectedServer.url ?? "",
                          name: displayName,
                          headers: getServerHeaders(selectedServer),
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
                          tunnelUrl ? `${tunnelUrl}/mcp` : selectedServer.url ?? ""
                        }
                        serverName={displayName}
                        serverId={undefined}
                        headers={getServerHeaders(selectedServer)}
                        language="typescript"
                      />
                      <SdkIntegrationModal
                        open={pySdkModalOpen}
                        onOpenChange={setPySdkModalOpen}
                        serverUrl={
                          tunnelUrl ? `${tunnelUrl}/mcp` : selectedServer.url ?? ""
                        }
                        serverName={displayName}
                        serverId={undefined}
                        headers={getServerHeaders(selectedServer)}
                        language="python"
                      />
                    </>
                  );
                })()}
              {/* Tunnel Badge - Mobile */}
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
              <Button
                asChild
                size="sm"
                className="rounded-full bg-blue-600 hover:bg-blue-700 text-white px-3"
              >
                <a
                  href={
                    isLoggedIn
                      ? "https://manufact.com/cloud?ref=mcp-use-inspector"
                      : "https://manufact.com/signup?ref=mcp-use-inspector"
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => {
                    try {
                      captureInspectorEvent(
                          new MCPDeployClickEvent({
                            referrer: "mcp-use-inspector",
                          })
                        )
                        .catch(() => {});
                    } catch {
                      // ignore telemetry errors
                    }
                  }}
                >
                  <Rocket className="size-4" />
                </a>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="p-2 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-full transition-colors"
                    aria-label="Settings"
                  >
                    <Settings className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      {theme === "light" ? (
                        <SunDim className="size-4 mr-2" />
                      ) : theme === "dark" ? (
                        <Moon className="size-4 mr-2" />
                      ) : (
                        <Monitor className="size-4 mr-2" />
                      )}
                      Theme
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuRadioGroup
                        value={theme}
                        onValueChange={(v) =>
                          setTheme(v as "light" | "dark" | "system")
                        }
                      >
                        <DropdownMenuRadioItem value="light">
                          <SunDim className="size-4 mr-2" />
                          Light
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="dark">
                          <Moon className="size-4 mr-2" />
                          Dark
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="system">
                          <Monitor className="size-4 mr-2" />
                          System
                        </DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <a
                      href="https://github.com/mcp-use/mcp-use"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <GithubIcon className="h-4 w-4 mr-2" />
                      GitHub
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a
                      href="https://github.com/mcp-use/mcp-use/issues/new?labels=inspector&template=bug_report.md&title=%5BInspector%5D+"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Bug className="size-4 mr-2" />
                      Report a Bug
                    </a>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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
                  if (tab.id === "separator") {
                    return (
                      <div
                        key="separator"
                        className="h-5 w-px bg-zinc-300 dark:bg-zinc-600 mx-1 shrink-0"
                      />
                    );
                  }
                  const count = getTabCount(tab.id, selectedServer);
                  const showDot = shouldShowDot(tab.id, count, collapsed);

                  return (
                    <TabsTrigger
                      key={tab.id}
                      value={tab.id}
                      data-testid={`tab-${tab.id}`}
                      icon={tab.icon}
                      showDot={showDot}
                      badge={
                        <TabCountBadge
                          count={count}
                          isActive={activeTab === tab.id}
                          size="sm"
                        />
                      }
                      alwaysExpanded={
                        "alwaysExpanded" in tab && tab.alwaysExpanded
                      }
                      className={cn(
                        "[&>svg]:mr-0 flex-1 flex-row gap-2 relative",
                        collapsed && "pl-2"
                      )}
                    >
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
                    if (tab.id === "separator") {
                      return (
                        <div
                          key="separator"
                          className="h-5 w-px bg-zinc-300 dark:bg-zinc-600 mx-1 shrink-0"
                        />
                      );
                    }
                    const count = getTabCount(tab.id, selectedServer);
                    const tooltipText =
                      count > 0 ? `${tab.label} (${count})` : tab.label;
                    const showDot = shouldShowDot(tab.id, count, collapsed);

                    return (
                      <TabsTrigger
                        key={tab.id}
                        value={tab.id}
                        data-testid={`tab-${tab.id}`}
                        icon={tab.icon}
                        showDot={showDot}
                        badge={
                          <TabCountBadge
                            count={count}
                            isActive={activeTab === tab.id}
                          />
                        }
                        alwaysExpanded={
                          "alwaysExpanded" in tab && tab.alwaysExpanded
                        }
                        className={cn(
                          "[&>svg]:mr-0 lg:[&>svg]:mr-2 relative",
                          collapsed && "pl-4"
                        )}
                        title={tooltipText}
                      >
                        <span className="items-center gap-2 hidden lg:flex">
                          {tab.label}
                        </span>
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
            {selectedServer &&
              (() => {
                const displayName = getServerDisplayName(selectedServer);
                return (
                  <>
                    <AddToClientDropdown
                      serverConfig={{
                        url: tunnelUrl
                          ? `${tunnelUrl}/mcp`
                          : selectedServer.url ?? "",
                        name: displayName,
                        headers: getServerHeaders(selectedServer),
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
                        tunnelUrl ? `${tunnelUrl}/mcp` : selectedServer.url ?? ""
                      }
                      serverName={displayName}
                      serverId={undefined}
                      headers={getServerHeaders(selectedServer)}
                      language="typescript"
                    />
                    <SdkIntegrationModal
                      open={pySdkModalOpen}
                      onOpenChange={setPySdkModalOpen}
                      serverUrl={
                        tunnelUrl ? `${tunnelUrl}/mcp` : selectedServer.url ?? ""
                      }
                      serverName={displayName}
                      serverId={undefined}
                      headers={getServerHeaders(selectedServer)}
                      language="python"
                    />
                  </>
                );
              })()}
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
            <Button
              asChild
              className="rounded-full bg-blue-600 hover:bg-blue-700 text-white px-4"
            >
              <a
                href={
                  isLoggedIn
                    ? "https://manufact.com/cloud?ref=mcp-use-inspector"
                    : "https://manufact.com/signup?ref=mcp-use-inspector"
                }
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => {
                  try {
                    captureInspectorEvent(
                      new MCPDeployClickEvent({
                        referrer: "mcp-use-inspector",
                      })
                    )
                      .catch(() => {});
                  } catch {
                    // ignore telemetry errors
                  }
                }}
              >
                <Rocket className="size-4" />
                <span className="hidden sm:inline">Deploy</span>
              </a>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="p-2 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-full transition-colors"
                  aria-label="Settings"
                >
                  <Settings className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  onClick={onCommandPaletteOpen}
                  data-testid="command-palette-trigger-button"
                >
                  <Command className="size-4 mr-2" />
                  Command Palette
                  <span className="ml-auto text-xs text-muted-foreground">
                    {"\u2318"}K
                  </span>
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    {theme === "light" ? (
                      <SunDim className="size-4 mr-2" />
                    ) : theme === "dark" ? (
                      <Moon className="size-4 mr-2" />
                    ) : (
                      <Monitor className="size-4 mr-2" />
                    )}
                    Theme
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuRadioGroup
                      value={theme}
                      onValueChange={(v) =>
                        setTheme(v as "light" | "dark" | "system")
                      }
                    >
                      <DropdownMenuRadioItem value="light">
                        <SunDim className="size-4 mr-2" />
                        Light
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="dark">
                        <Moon className="size-4 mr-2" />
                        Dark
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="system">
                        <Monitor className="size-4 mr-2" />
                        System
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <a
                    href="https://github.com/mcp-use/mcp-use"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <GithubIcon className="h-4 w-4 mr-2" />
                    GitHub
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a
                    href="https://github.com/mcp-use/mcp-use/issues/new?labels=inspector&template=bug_report.md&title=%5BInspector%5D+"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Bug className="size-4 mr-2" />
                    Report a Bug
                  </a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* In hosted mode: avatar left, logo right.
                Logo is always visible at ≥1400px; at narrower widths it falls
                back as a placeholder only when the user is unauthenticated. */}
            {embeddedConfig.chatApiUrl ? (
              <div className="flex items-center gap-2">
                {/* Avatar (or nothing when unauthenticated — logo handles branding) */}
                <HostedUserMenu
                  chatApiUrl={embeddedConfig.chatApiUrl}
                  onUserResolved={(u) => setIsLoggedIn(!!u)}
                  fallback={
                    /* Narrow screens only: show logo as fallback when not authed */
                    <span className="[@media(min-width:1400px)]:hidden">
                      <LogoAnimated state="expanded" />
                    </span>
                  }
                />
                {/* Logo: always visible at ≥1400px (rightmost) */}
                <span className="hidden [@media(min-width:1400px)]:block">
                  <LogoAnimated state="expanded" />
                </span>
              </div>
            ) : (
              <LogoAnimated state="expanded" />
            )}
          </div>
        )}
      </div>
    </header>
  );
}
