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
import {
  isInspectorSamplingAvailable,
  STATELESS_SAMPLING_UNSUPPORTED_MESSAGE,
} from "@/client/utils/samplingProtocol";
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
import { getTabCount, isMcpUseTunnelUrl } from "./layout/layoutHeaderUtils";
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
        {renderLoginButton()}
      </div>
    );
  };

  const renderLoginButton = (compact = false) =>
    embeddedConfig.chatApiUrl ? (
      <HostedUserMenu
        chatApiUrl={embeddedConfig.chatApiUrl}
        onUserResolved={(u) => setIsLoggedIn(!!u)}
        compact={compact}
      />
    ) : null;

  return (
    <header className="w-full min-w-0 shrink-0 overflow-hidden">
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

      <div className="flex lg:hidden min-w-0 w-full flex-col overflow-hidden pt-(--mobile-chrome-gap)">
        <div className="flex min-h-0 items-center gap-2 pb-(--mobile-chrome-gap)">
          {!embedded && (
            <>
              <div className="flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden">
                <LogoAnimated
                  state="collapsed"
                  showLabel
                  labelParts="inspector"
                  className="shrink-0"
                />
                <span className="shrink-0 px-0.5 text-sm text-muted-foreground/60 [text-box:trim-both_cap_alphabetic]">
                  /
                </span>
                <div className="min-w-0 flex-1">
                  <ServerDropdown
                    connections={connections}
                    selectedServer={selectedServer}
                    onServerSelect={onServerSelect}
                    variant="header"
                    compactHeader
                  />
                </div>
              </div>
              <div className="shrink-0">{renderLoginButton(true)}</div>
            </>
          )}
        </div>

        {selectedServer && (
          <div className="w-full min-w-0 pb-(--mobile-chrome-gap) lg:hidden">
            <Tabs
              value={activeTab}
              onValueChange={(tab) => onTabChange(tab as TabType)}
              collapsed={mobileTabsCollapsed}
              className="w-full"
            >
              <TabsList className="w-full gap-0 border-0 bg-transparent p-0 [&_[role=tablist]]:justify-between">
                {filteredTabs
                  .filter((tab) => tab.id !== "separator")
                  .map((tab) => {
                    const count = getTabCount(tab.id, selectedServer);
                    const isDisabled =
                      tab.id === "sampling" &&
                      !isInspectorSamplingAvailable(selectedServer);

                    const trigger = (
                      <TabsTrigger
                        value={tab.id}
                        disabled={isDisabled}
                        disabledTooltip={
                          isDisabled
                            ? STATELESS_SAMPLING_UNSUPPORTED_MESSAGE
                            : undefined
                        }
                        data-testid={`tab-${tab.id}`}
                        icon={tab.icon}
                        iconOnly
                        title={isDisabled ? undefined : tab.label}
                        badge={
                          count > 0 ? (
                            <TabCountBadge
                              count={count}
                              isActive={activeTab === tab.id}
                              overlay
                            />
                          ) : undefined
                        }
                        className="size-9 shrink-0 rounded-full p-0"
                      >
                        <span className="sr-only">{tab.label}</span>
                      </TabsTrigger>
                    );

                    return (
                      <span key={tab.id} className="contents">
                        {trigger}
                      </span>
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
