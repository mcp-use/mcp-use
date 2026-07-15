import type { McpServer } from "@mcp-use/client/react";
import type { ReactNode, RefObject } from "react";
import { useInspector } from "@/client/context/InspectorContext";
import type { TabType } from "@/client/context/InspectorContext";
import { isLocalhostServerUrl } from "@/client/utils/servers";
import { ChatTab } from "./ChatTab";
import {
  buildManagedLlmProxyConfig,
  shouldUseManagedClientSide,
} from "./chat/freeTier";
import { ConnectionSettingsTab } from "./ConnectionSettingsTab";
import { ElicitationTab } from "./ElicitationTab";
import { NotificationsTab } from "./NotificationsTab";
import { PromptsTab } from "./PromptsTab";
import { ResourcesTab } from "./ResourcesTab";
import { SamplingTab } from "./SamplingTab";
import { ServerMetadataTab } from "./ServerMetadataTab";
import { ToolsTab } from "./ToolsTab";

import type { EditableConnectionConfig } from "@/client/utils/connectionUpdates";

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
    if (!embeddedConfig.visibleTabs) return true;
    return embeddedConfig.visibleTabs.includes(tab);
  };

  const allKnownTabs: TabType[] = [
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

  // Localhost MCP + hosted chat URL: browser MCPAgent owns tools; only LLM
  // calls go through the cloud `/inspector/llm/*` proxy (MCP-2419 follow-up).
  const isLoopbackServer =
    !!selectedServer.url && isLocalhostServerUrl(selectedServer.url);
  const useManagedClientSide = shouldUseManagedClientSide({
    isLoopback: isLoopbackServer,
    chatApiUrl: embeddedConfig.chatApiUrl,
    enableFreeTierUpgrade: embeddedConfig.chatEnableFreeTierUpgrade,
  });
  const chatApiUrl = embeddedConfig.chatApiUrl;
  const managedLlmConfig = useManagedClientSide
    ? buildManagedLlmProxyConfig(chatApiUrl!)
    : (embeddedConfig.managedLlmConfig ??
      (chatApiUrl && !isLoopbackServer
        ? {
            provider: "anthropic" as const,
            model: "claude-haiku-4-5",
            apiKey: "server-managed",
          }
        : undefined));

  // Render all visible tabs but hide inactive ones to preserve state
  return (
    <>
      {isTabVisible("tools") && (
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
      {isTabVisible("prompts") && (
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
      {isTabVisible("resources") && (
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
      {isTabVisible("chat") && (
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
            managedLlmConfig={managedLlmConfig}
            enableFreeTierUpgrade={embeddedConfig.chatEnableFreeTierUpgrade}
            hideTitle={embeddedConfig.chatHideTitle}
            hideModelBadge={embeddedConfig.chatHideModelBadge ?? !!chatApiUrl}
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
            credentials={embeddedConfig.chatCredentials}
            managedKeyUnavailable={
              isLoopbackServer && !chatApiUrl && !useManagedClientSide
            }
          />
        </div>
      )}
      {isTabVisible("sampling") && (
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
      {isTabVisible("elicitation") && (
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
      {isTabVisible("notifications") && (
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
      {isTabVisible("server-metadata") && (
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
      {isTabVisible("connection-settings") && onUpdateConnection && (
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
