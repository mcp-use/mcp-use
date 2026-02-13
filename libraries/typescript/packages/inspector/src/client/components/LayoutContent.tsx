import type { McpServer } from "mcp-use/react";
import type { ReactNode, RefObject } from "react";
import { useInspector } from "@/client/context/InspectorContext";
import type { TabType } from "@/client/context/InspectorContext";
import { ChatTab } from "./ChatTab";
import { ElicitationTab } from "./ElicitationTab";
import { NotificationsTab } from "./NotificationsTab";
import { PromptsTab } from "./PromptsTab";
import { ResourcesTab } from "./ResourcesTab";
import { SamplingTab } from "./SamplingTab";
import { ToolsTab } from "./ToolsTab";

// Type alias for backward compatibility
type MCPConnection = McpServer;

interface LayoutContentProps {
  selectedServer: MCPConnection | undefined;
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
  children: ReactNode;
}

export function LayoutContent({
  selectedServer,
  activeTab,
  toolsSearchRef,
  promptsSearchRef,
  resourcesSearchRef,
  children,
}: LayoutContentProps) {
  const { embeddedConfig } = useInspector();

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
  ];

  // Render all visible tabs but hide inactive ones to preserve state
  return (
    <>
      {isTabVisible("tools") && (
        <div
          style={{ display: activeTab === "tools" ? "block" : "none" }}
          className="h-full"
        >
          <ToolsTab
            key={`tools-${selectedServer.id}-${selectedServer.state}`}
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
            key={`prompts-${selectedServer.id}-${selectedServer.state}`}
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
            key={`resources-${selectedServer.id}-${selectedServer.state}`}
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
            key={`chat-${selectedServer.id}-${selectedServer.state}`}
            connection={selectedServer}
            isConnected={selectedServer.state === "ready"}
            prompts={selectedServer.prompts}
            serverId={selectedServer.id}
            callPrompt={selectedServer.getPrompt}
            readResource={selectedServer.readResource}
            useClientSide={!embeddedConfig.chatApiUrl}
            chatApiUrl={embeddedConfig.chatApiUrl}
            managedLlmConfig={
              embeddedConfig.managedLlmConfig ??
              (embeddedConfig.chatApiUrl
                ? {
                    provider: "anthropic",
                    model: "server-managed",
                    apiKey: "server-managed",
                  }
                : undefined)
            }
            hideTitle={embeddedConfig.chatHideTitle}
            hideModelBadge={
              embeddedConfig.chatHideModelBadge ?? !!embeddedConfig.chatApiUrl
            }
            hideServerUrl={
              embeddedConfig.chatHideServerUrl ?? !!embeddedConfig.chatApiUrl
            }
            clearButtonLabel={embeddedConfig.chatClearButtonLabel}
            clearButtonHideIcon={embeddedConfig.chatClearButtonHideIcon}
            clearButtonHideShortcut={embeddedConfig.chatClearButtonHideShortcut}
            clearButtonVariant={embeddedConfig.chatClearButtonVariant}
            chatQuickQuestions={embeddedConfig.chatQuickQuestions}
            chatFollowups={embeddedConfig.chatFollowups}
          />
        </div>
      )}
      {isTabVisible("sampling") && (
        <div
          style={{ display: activeTab === "sampling" ? "block" : "none" }}
          className="h-full"
        >
          <SamplingTab
            key={`sampling-${selectedServer.id}-${selectedServer.state}`}
            pendingRequests={selectedServer.pendingSamplingRequests}
            onApprove={selectedServer.approveSampling}
            onReject={selectedServer.rejectSampling}
            serverId={selectedServer.id}
            isConnected={selectedServer.state === "ready"}
            mcpServerUrl={selectedServer.url}
          />
        </div>
      )}
      {isTabVisible("elicitation") && (
        <div
          style={{ display: activeTab === "elicitation" ? "block" : "none" }}
          className="h-full"
        >
          <ElicitationTab
            key={`elicitation-${selectedServer.id}-${selectedServer.state}`}
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
            key={`notifications-${selectedServer.id}-${selectedServer.state}`}
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
      {!allKnownTabs.includes(activeTab as TabType) && <>{children}</>}
    </>
  );
}
