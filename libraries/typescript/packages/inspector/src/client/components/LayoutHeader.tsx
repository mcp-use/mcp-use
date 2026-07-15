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
import { getServerHeaders } from "@/client/utils/connectionUpdates";
import { getServerDisplayName } from "@/client/utils/servers";
import {
  Bug,
  ChevronDown,
  Command,
  Monitor,
  Moon,
  Plus,
  Settings,
  SunDim,
} from "lucide-react";
import type { McpServer } from "@mcp-use/client/react";
import { useState } from "react";
import { toast } from "sonner";
import { HostedUserMenu } from "@/client/components/HostedUserMenu";
import {
  MCPDeployClickEvent,
  captureInspectorEvent,
} from "@/client/telemetry";
import { useTheme } from "@/client/context/ThemeContext";
import { TabCountBadge } from "./shared/TabCountBadge";
import { AddToClientDropdown } from "./AddToClientDropdown";
import LogoAnimated from "./LogoAnimated";
import { SdkIntegrationModal } from "./SdkIntegrationModal";
import { ServerDropdown } from "./ServerDropdown";
import { getTabCount, shouldShowDot } from "./layout/layoutHeaderUtils";
import { LAYOUT_TABS } from "./layout/layoutTabs";
import { ServerUrlChip } from "./layout/ServerUrlChip";

interface LayoutHeaderProps {
  connections: McpServer[];
  selectedServer: McpServer | undefined;
  activeTab: string;
  onServerSelect: (serverId: string) => void;
  onTabChange: (tab: TabType) => void;
  onCommandPaletteOpen: () => void;
  embedded?: boolean;
  sidebarCollapsed?: boolean;
}

export function LayoutHeader({
  connections,
  selectedServer,
  activeTab,
  onServerSelect,
  onTabChange,
  onCommandPaletteOpen,
  embedded = false,
  sidebarCollapsed = false,
}: LayoutHeaderProps) {
  const { tunnelUrl, embeddedConfig } = useInspector();
  const { theme, setTheme } = useTheme();
  const [tsSdkModalOpen, setTsSdkModalOpen] = useState(false);
  const [pySdkModalOpen, setPySdkModalOpen] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [mobileTabsCollapsed] = useState(true);

  if (embeddedConfig.singleTab) {
    return null;
  }

  const filteredTabs = embeddedConfig.visibleTabs
    ? LAYOUT_TABS.filter(
        (t) =>
          t.id === "separator" ||
          embeddedConfig.visibleTabs!.includes(t.id as TabType)
      )
    : LAYOUT_TABS;

  const serverUrl = selectedServer
    ? tunnelUrl
      ? `${tunnelUrl}/mcp`
      : (selectedServer.url ?? "")
    : "";

  const renderActionButtons = () => {
    if (embedded) return null;

    return (
      <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
        {selectedServer &&
          (() => {
            const displayName = getServerDisplayName(selectedServer);
            return (
              <>
                <AddToClientDropdown
                  serverConfig={{
                    url: serverUrl,
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
                  serverUrl={serverUrl}
                  serverName={displayName}
                  serverId={undefined}
                  headers={getServerHeaders(selectedServer)}
                  language="typescript"
                />
                <SdkIntegrationModal
                  open={pySdkModalOpen}
                  onOpenChange={setPySdkModalOpen}
                  serverUrl={serverUrl}
                  serverName={displayName}
                  serverId={undefined}
                  headers={getServerHeaders(selectedServer)}
                  language="python"
                />
              </>
            );
          })()}
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
                new MCPDeployClickEvent({ referrer: "mcp-use-inspector" })
              ).catch(() => {});
            } catch {
              // ignore
            }
          }}
          className="inline-flex h-8 items-center justify-center rounded-full border border-blue-500/25 bg-blue-500/10 px-4 text-[13px] text-blue-500 outline-none cursor-pointer transition-colors hover:bg-blue-500/15 dark:border-blue-400/30 dark:bg-blue-400/10 dark:text-blue-400 dark:hover:bg-blue-400/15 focus-visible:ring-1 focus-visible:ring-ring"
        >
          <span className="[text-box:trim-both_cap_alphabetic]">Deploy</span>
        </a>
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
        {embeddedConfig.chatApiUrl ? (
          <HostedUserMenu
            chatApiUrl={embeddedConfig.chatApiUrl}
            onUserResolved={(u) => setIsLoggedIn(!!u)}
          />
        ) : null}
      </div>
    );
  };

  return (
    <header className="w-full shrink-0">
      <div className="hidden lg:flex h-(--header-height) items-center justify-between gap-3 px-4 md:pl-0 md:pr-6">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {!embedded && (
            <>
              <div
                className={cn(
                  "hidden lg:block shrink-0",
                  sidebarCollapsed &&
                    "-mr-[calc(var(--sidebar-width-icon)/2-0.625rem)]"
                )}
              >
                <LogoAnimated
                  pinSymbolInIconColumn
                  showLabel={!sidebarCollapsed}
                  state={sidebarCollapsed ? "collapsed" : "expanded"}
                />
              </div>
              <span className="text-muted-foreground/60 shrink-0">/</span>
              <ServerDropdown
                connections={connections}
                selectedServer={selectedServer}
                onServerSelect={onServerSelect}
                variant="header"
              />
              {selectedServer && serverUrl && (
                <ServerUrlChip url={serverUrl} />
              )}
            </>
          )}
        </div>
        {renderActionButtons()}
      </div>

      <div className="flex lg:hidden flex-col gap-3">
        <div className="flex items-center justify-between w-full">
          {!embedded && (
            <>
              <div className="flex-1 flex justify-start">
                <ServerDropdown
                  connections={connections}
                  selectedServer={selectedServer}
                  onServerSelect={onServerSelect}
                  mobileMode
                />
              </div>
              <div className="flex-shrink-0 flex justify-center">
                <LogoAnimated state="collapsed" showLabel />
              </div>
              <div className="flex-1 flex justify-end">{renderActionButtons()}</div>
            </>
          )}
        </div>

        {selectedServer && serverUrl && !embedded && (
          <ServerUrlChip url={serverUrl} className="px-1" />
        )}

        {selectedServer && (
          <div className="w-full lg:hidden">
            <Tabs
              value={activeTab}
              onValueChange={(tab) => onTabChange(tab as TabType)}
              collapsed={mobileTabsCollapsed}
            >
              <TabsList className="w-full justify-center border-0 bg-transparent p-0">
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
                  const showDot = shouldShowDot(
                    tab.id,
                    count,
                    mobileTabsCollapsed
                  );

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
                        mobileTabsCollapsed && "pl-2"
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
    </header>
  );
}
