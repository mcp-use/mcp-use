import { Button } from "@/client/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/client/components/ui/tabs";
import type { TabType } from "@/client/context/InspectorContext";
import { useInspector } from "@/client/context/InspectorContext";
import { cn } from "@/client/lib/utils";
import { getServerHeaders } from "@/client/utils/connectionUpdates";
import {
  getServerDisplayName,
  isLocalhostServerUrl,
} from "@/client/utils/servers";
import { getBasePath } from "@/client/utils/basePath";
import { ChevronDown, Plus } from "lucide-react";
import type { McpServer } from "@mcp-use/client/react";
import { useState } from "react";
import { toast } from "sonner";
import { HostedUserMenu } from "@/client/components/HostedUserMenu";
import { MCPDeployClickEvent, captureInspectorEvent } from "@/client/telemetry";
import { TabCountBadge } from "./shared/TabCountBadge";
import { AddToClientDropdown } from "./AddToClientDropdown";
import LogoAnimated from "./LogoAnimated";
import { ServerDropdown } from "./ServerDropdown";
import {
  getTabCount,
  isMcpUseTunnelUrl,
  shouldShowDot,
} from "./layout/layoutHeaderUtils";
import { LAYOUT_TABS } from "./layout/layoutTabs";
import { ServerUrlChip } from "./layout/ServerUrlChip";
import { TunnelStartButton } from "./layout/TunnelBadge";
import { useTunnelControls } from "./layout/useTunnelControls";
import { useTunnelPopoverOpen } from "./layout/useTunnelPopoverOpen";

interface LayoutHeaderProps {
  connections: McpServer[];
  selectedServer: McpServer | undefined;
  activeTab: string;
  onServerSelect: (serverId: string) => void;
  onTabChange: (tab: TabType) => void;
  embedded?: boolean;
  sidebarCollapsed?: boolean;
}

export function LayoutHeader({
  connections,
  selectedServer,
  activeTab,
  onServerSelect,
  onTabChange,
  embedded = false,
  sidebarCollapsed = false,
}: LayoutHeaderProps) {
  const {
    tunnelUrl,
    isTunnelStarting,
    setTunnelUrl,
    setIsTunnelStarting,
    embeddedConfig,
  } = useInspector();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [mobileTabsCollapsed] = useState(true);

  const tunnelPopover = useTunnelPopoverOpen(tunnelUrl);

  const tunnel = useTunnelControls({
    tunnelUrl,
    setTunnelUrl,
    isTunnelStarting,
    setIsTunnelStarting,
    onTunnelStarted: tunnelPopover.openWithAutoCopy,
  });

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

  const onServerRoute = !!selectedServer;

  const showTunnelBadge =
    !!selectedServer &&
    (isLocalhostServerUrl(selectedServer.url ?? "") ||
      isMcpUseTunnelUrl(selectedServer.url ?? "") ||
      !!tunnelUrl);

  const serverUrl = selectedServer
    ? tunnelUrl
      ? `${tunnelUrl.replace(/\/+$/, "")}${getBasePath()}`
      : (selectedServer.url ?? "")
    : "";

  const displayMcpUrl =
    tunnel.mcpUrl ??
    (tunnelUrl ? `${tunnelUrl.replace(/\/+$/, "")}${getBasePath()}` : null);

  const renderUrlCluster = (
    row: "desktop" | "mobile",
    chipClassName?: string
  ) => {
    if (!selectedServer || !serverUrl) return null;
    const rowVisible =
      row === "desktop" ? tunnelPopover.isLgUp : !tunnelPopover.isLgUp;

    return (
      <div className="flex items-center gap-1 min-w-0">
        <ServerUrlChip
          url={serverUrl}
          className={chipClassName}
          tunnelPopover={
            tunnelUrl && displayMcpUrl && rowVisible
              ? {
                  mcpUrl: displayMcpUrl,
                  onStop: tunnel.handleStopTunnel,
                  open: tunnelPopover.open,
                  onOpenChange: tunnelPopover.onOpenChange,
                  autoCopyOnOpen: tunnelPopover.autoCopyOnOpen,
                }
              : undefined
          }
        />
        {showTunnelBadge && !tunnelUrl && (
          <TunnelStartButton
            devFromCli={tunnel.devFromCli}
            isTunnelStarting={isTunnelStarting}
            waitTicks={tunnel.waitTicks}
            onStart={tunnel.handleStartTunnel}
          />
        )}
      </div>
    );
  };

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
                  onServerRoute &&
                    sidebarCollapsed &&
                    "-mr-[calc(var(--sidebar-width-icon)/2-0.625rem)]"
                )}
              >
                <LogoAnimated
                  pinSymbolInIconColumn
                  showLabel={!onServerRoute || !sidebarCollapsed}
                  state={
                    onServerRoute && sidebarCollapsed ? "collapsed" : "expanded"
                  }
                />
              </div>
              <span className="text-sm text-muted-foreground/60 shrink-0 [text-box:trim-both_cap_alphabetic]">
                /
              </span>
              <ServerDropdown
                connections={connections}
                selectedServer={selectedServer}
                onServerSelect={onServerSelect}
                variant="header"
              />
              {renderUrlCluster("desktop")}
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
              <div className="flex-1 flex justify-end">
                {renderActionButtons()}
              </div>
            </>
          )}
        </div>

        {selectedServer && serverUrl && !embedded && (
          <div className="flex items-center gap-2 px-1 min-w-0">
            {renderUrlCluster("mobile", "min-w-0")}
          </div>
        )}

        {selectedServer && (
          <div className="w-full lg:hidden">
            <Tabs
              value={activeTab}
              onValueChange={(tab) => onTabChange(tab as TabType)}
              collapsed={mobileTabsCollapsed}
            >
              <TabsList className="w-full justify-center border-0 bg-transparent p-0">
                {filteredTabs.map((tab, index) => {
                  if (tab.id === "separator") {
                    return (
                      <div
                        key={`separator-${index}`}
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
