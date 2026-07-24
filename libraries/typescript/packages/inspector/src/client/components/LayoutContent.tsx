import type { McpServer } from "@mcp-use/client/react";
import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { useManufactAuth } from "@/client/auth/manufact-auth";
import { ChatTab } from "@/client/components/ChatTab";
import { ConnectionSettingsTab } from "@/client/components/ConnectionSettingsTab";
import { ElicitationTab } from "@/client/components/ElicitationTab";
import { NotificationsTab } from "@/client/components/NotificationsTab";
import { PromptsTab } from "@/client/components/PromptsTab";
import { ResourcesTab } from "@/client/components/ResourcesTab";
import { SamplingTab } from "@/client/components/SamplingTab";
import { ServerMetadataTab } from "@/client/components/ServerMetadataTab";
import { ToolsTab } from "@/client/components/ToolsTab";
import { useInspector } from "@/client/context/InspectorContext";
import type { TabType } from "@/client/context/InspectorContext";
import { isInspectorSamplingAvailable } from "@/client/utils/samplingProtocol";
import { isLocalhostServerUrl } from "@/client/utils/servers";
import {
  buildManagedAuthHeaders,
  buildManagedLlmProxyConfig,
  shouldUseManagedClientSide,
} from "./chat/freeTier";
import { useManagedCloudModel } from "./chat/useManagedCloudModel";

import type { EditableConnectionConfig } from "@/client/utils/connectionUpdates";

const ALL_KNOWN_TABS: TabType[] = [
  "tools",
  "prompts",
  "resources",
  "chat",
  "sampling",
  "elicitation",
  "notifications",
  "server-metadata",
  "connection-settings",
];

function normalizeTab(tab: string): TabType {
  return ALL_KNOWN_TABS.includes(tab as TabType) ? (tab as TabType) : "tools";
}

interface LayoutContentProps {
  selectedServer: McpServer | undefined;
  activeTab: string;
  toolsSearchRef: RefObject<{
    focusSearch: () => void;
    blurSearch: () => void;
  } | null>;
  promptsSearchRef: RefObject<{
    focusSearch: () => void;
    blurSearch: () => void;
  } | null>;
  resourcesSearchRef: RefObject<{
    focusSearch: () => void;
    blurSearch: () => void;
  } | null>;
  onUpdateConnection?: (config: EditableConnectionConfig) => void;
  children: ReactNode;
}

export function LayoutContent({
  selectedServer,
  activeTab,
  toolsSearchRef,
  promptsSearchRef,
  resourcesSearchRef,
  onUpdateConnection,
  children,
}: LayoutContentProps) {
  const { embeddedConfig } = useInspector();
  const initialTab = normalizeTab(activeTab);
  const [mountedTabs, setMountedTabs] = useState<Set<TabType>>(
    () => new Set([initialTab])
  );

  useEffect(() => {
    const tab = normalizeTab(activeTab);
    setMountedTabs((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
  }, [activeTab]);

  const {
    accessToken,
    mode: manufactAuthMode,
    user,
  } = useManufactAuth(embeddedConfig.chatApiUrl);
  const managedAuthHeaders = buildManagedAuthHeaders(accessToken);
  const managedCredentials =
    manufactAuthMode === "session" ? ("include" as const) : undefined;
  const isManufactAuthenticated = user != null;

  const chatApiUrl = embeddedConfig.chatApiUrl;
  const isLoopbackServer =
    !!selectedServer?.url && isLocalhostServerUrl(selectedServer.url);
  const useManagedClientSide = selectedServer
    ? shouldUseManagedClientSide({
        isLoopback: isLoopbackServer,
        chatApiUrl: embeddedConfig.chatApiUrl,
        enableFreeTierUpgrade: embeddedConfig.chatEnableFreeTierUpgrade,
      })
    : false;
  const managedCloudModel = useManagedCloudModel(
    chatApiUrl,
    accessToken,
    manufactAuthMode,
    !!selectedServer && !!chatApiUrl && isManufactAuthenticated
  );
  const managedLlmConfig = useManagedClientSide
    ? buildManagedLlmProxyConfig(
        chatApiUrl!,
        accessToken,
        manufactAuthMode === "session",
        isManufactAuthenticated ? managedCloudModel.selectedModelId : undefined
      )
    : (embeddedConfig.managedLlmConfig ??
      (chatApiUrl && !isLoopbackServer
        ? {
            provider: "anthropic" as const,
            model: "claude-haiku-4-5",
            apiKey: "server-managed",
          }
        : undefined));

  // When forceConnected is enabled, render the chat tab directly without a
  // real server connection. The backend (chatApiUrl) manages everything.
  if (!selectedServer && embeddedConfig.forceConnected) {
    if (!embeddedConfig.chatApiUrl) {
      return <>{children}</>;
    }
    const stubConnection = {
      id: "force-connected",
      url: "",
      displayName: "",
      name: "",
      state: "ready" as const,
      tools: [],
      prompts: [],
      resources: [],
    } as unknown as McpServer;

    return (
      <ChatTab
        key="chat-force-connected"
        connection={stubConnection}
        isConnected={true}
        prompts={[]}
        serverId="force-connected"
        callPrompt={async () => ({ messages: [] })}
        readResource={async () => ({ contents: [] })}
        useClientSide={false}
        chatApiUrl={embeddedConfig.chatApiUrl}
        extraHeaders={managedAuthHeaders}
        credentials={managedCredentials}
        managedLlmConfig={
          embeddedConfig.managedLlmConfig ?? {
            provider: "anthropic",
            model: "claude-haiku-4-5",
            apiKey: "server-managed",
          }
        }
        enableFreeTierUpgrade={embeddedConfig.chatEnableFreeTierUpgrade}
        hideTitle={embeddedConfig.chatHideTitle}
        hideModelBadge={embeddedConfig.chatHideModelBadge ?? true}
        hideServerUrl={embeddedConfig.chatHideServerUrl ?? true}
        clearButtonLabel={embeddedConfig.chatClearButtonLabel}
        clearButtonHideIcon={embeddedConfig.chatClearButtonHideIcon}
        clearButtonHideShortcut={embeddedConfig.chatClearButtonHideShortcut}
        clearButtonVariant={embeddedConfig.chatClearButtonVariant}
        chatQuickQuestions={embeddedConfig.chatQuickQuestions}
        chatFollowups={embeddedConfig.chatFollowups}
        hideClearButton={embeddedConfig.chatHideClearButton}
        hideToolSelector={embeddedConfig.chatHideToolSelector}
        enableKeyboardShortcuts={false}
      />
    );
  }

  if (!selectedServer) {
    return <>{children}</>;
  }

  // Helper to check if a tab should be rendered
  const isTabVisible = (tab: TabType): boolean => {
    if (tab === "sampling" && !isInspectorSamplingAvailable(selectedServer)) {
      return false;
    }
    if (!embeddedConfig.visibleTabs) return true;
    return embeddedConfig.visibleTabs.includes(tab);
  };

  const allKnownTabs = ALL_KNOWN_TABS;

  // Mount tabs on first visit; keep mounted (display:none) to preserve state.
  return (
    <>
      {isTabVisible("tools") && mountedTabs.has("tools") && (
        <div
          style={{ display: activeTab === "tools" ? "block" : "none" }}
          className="h-full"
        >
          <ToolsTab
            key={`tools-${selectedServer.id}`}
            ref={toolsSearchRef}
            tools={selectedServer.tools}
            callTool={selectedServer.callTool}
            readResource={selectedServer.readResource}
            serverId={selectedServer.id}
            isConnected={selectedServer.state === "ready"}
            refreshTools={selectedServer.refreshTools}
          />
        </div>
      )}
      {isTabVisible("prompts") && mountedTabs.has("prompts") && (
        <div
          style={{ display: activeTab === "prompts" ? "block" : "none" }}
          className="h-full"
        >
          <PromptsTab
            key={`prompts-${selectedServer.id}`}
            ref={promptsSearchRef}
            prompts={selectedServer.prompts}
            callPrompt={(name, args) =>
              selectedServer.getPrompt(
                name,
                args
                  ? (Object.fromEntries(
                      Object.entries(args).map(([k, v]) => [
                        k,
                        typeof v === "string" ? v : String(v ?? ""),
                      ])
                    ) as Record<string, string>)
                  : undefined
              )
            }
            serverId={selectedServer.id}
            isConnected={selectedServer.state === "ready"}
            refreshPrompts={selectedServer.refreshPrompts}
          />
        </div>
      )}
      {isTabVisible("resources") && mountedTabs.has("resources") && (
        <div
          style={{ display: activeTab === "resources" ? "block" : "none" }}
          className="h-full"
        >
          <ResourcesTab
            key={`resources-${selectedServer.id}`}
            ref={resourcesSearchRef}
            resources={selectedServer.resources}
            readResource={selectedServer.readResource}
            serverId={selectedServer.id}
            isConnected={selectedServer.state === "ready"}
            mcpServerUrl={selectedServer.url || ""}
            refreshResources={selectedServer.refreshResources}
          />
        </div>
      )}
      {isTabVisible("chat") && mountedTabs.has("chat") && (
        <div
          style={{ display: activeTab === "chat" ? "block" : "none" }}
          className="h-full"
        >
          <ChatTab
            key={`chat-${selectedServer.id}`}
            connection={selectedServer}
            isConnected={
              embeddedConfig.forceConnected || selectedServer.state === "ready"
            }
            prompts={selectedServer.prompts}
            serverId={selectedServer.id}
            callPrompt={(name, args) =>
              selectedServer.getPrompt(
                name,
                args
                  ? (Object.fromEntries(
                      Object.entries(args).map(([k, v]) => [
                        k,
                        typeof v === "string" ? v : String(v ?? ""),
                      ])
                    ) as Record<string, string>)
                  : undefined
              )
            }
            readResource={selectedServer.readResource}
            useClientSide={useManagedClientSide || !chatApiUrl}
            chatApiUrl={chatApiUrl}
            extraHeaders={managedAuthHeaders}
            credentials={embeddedConfig.chatCredentials ?? managedCredentials}
            managedLlmConfig={managedLlmConfig}
            managedCloudModel={managedCloudModel}
            enableFreeTierUpgrade={embeddedConfig.chatEnableFreeTierUpgrade}
            hideTitle={embeddedConfig.chatHideTitle}
            hideModelBadge={embeddedConfig.chatHideModelBadge ?? false}
            hideServerUrl={embeddedConfig.chatHideServerUrl ?? !!chatApiUrl}
            clearButtonLabel={embeddedConfig.chatClearButtonLabel}
            clearButtonHideIcon={embeddedConfig.chatClearButtonHideIcon}
            clearButtonHideShortcut={embeddedConfig.chatClearButtonHideShortcut}
            clearButtonVariant={embeddedConfig.chatClearButtonVariant}
            chatQuickQuestions={embeddedConfig.chatQuickQuestions}
            chatFollowups={embeddedConfig.chatFollowups}
            hideClearButton={embeddedConfig.chatHideClearButton}
            hideToolSelector={embeddedConfig.chatHideToolSelector}
            streamProtocol={embeddedConfig.chatStreamProtocol}
          />
        </div>
      )}
      {isTabVisible("sampling") && mountedTabs.has("sampling") && (
        <div
          style={{ display: activeTab === "sampling" ? "block" : "none" }}
          className="h-full"
        >
          <SamplingTab
            key={`sampling-${selectedServer.id}`}
            pendingRequests={selectedServer.pendingSamplingRequests}
            onApprove={selectedServer.approveSampling}
            onReject={selectedServer.rejectSampling}
            serverId={selectedServer.id}
            isConnected={selectedServer.state === "ready"}
            mcpServerUrl={selectedServer.url ?? ""}
          />
        </div>
      )}
      {isTabVisible("elicitation") && mountedTabs.has("elicitation") && (
        <div
          style={{ display: activeTab === "elicitation" ? "block" : "none" }}
          className="h-full"
        >
          <ElicitationTab
            key={`elicitation-${selectedServer.id}`}
            pendingRequests={selectedServer.pendingElicitationRequests}
            onApprove={selectedServer.approveElicitation}
            onReject={selectedServer.rejectElicitation}
            serverId={selectedServer.id}
            isConnected={selectedServer.state === "ready"}
          />
        </div>
      )}
      {isTabVisible("notifications") && mountedTabs.has("notifications") && (
        <div
          style={{
            display: activeTab === "notifications" ? "block" : "none",
          }}
          className="h-full"
        >
          <NotificationsTab
            key={`notifications-${selectedServer.id}`}
            notifications={selectedServer.notifications}
            unreadCount={selectedServer.unreadNotificationCount}
            markNotificationRead={selectedServer.markNotificationRead}
            markAllNotificationsRead={selectedServer.markAllNotificationsRead}
            clearNotifications={selectedServer.clearNotifications}
            serverId={selectedServer.id}
            isConnected={selectedServer.state === "ready"}
          />
        </div>
      )}
      {isTabVisible("server-metadata") &&
        mountedTabs.has("server-metadata") && (
          <div
            style={{
              display: activeTab === "server-metadata" ? "block" : "none",
            }}
            className="h-full"
          >
            <ServerMetadataTab
              key={`server-metadata-${selectedServer.id}`}
              connection={selectedServer}
            />
          </div>
        )}
      {isTabVisible("connection-settings") &&
        mountedTabs.has("connection-settings") &&
        onUpdateConnection && (
          <div
            style={{
              display: activeTab === "connection-settings" ? "block" : "none",
            }}
            className="h-full"
          >
            <ConnectionSettingsTab
              key={`connection-settings-${selectedServer.id}`}
              connection={selectedServer}
              onSave={onUpdateConnection}
            />
          </div>
        )}
      {!allKnownTabs.includes(activeTab as TabType) && <>{children}</>}
    </>
  );
}
