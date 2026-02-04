import type { McpServer } from "mcp-use/react";
import type { ReactNode, RefObject } from "react";
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
  if (!selectedServer) {
    return <>{children}</>;
  }

  // Render all tabs but hide inactive ones to preserve state
  return (
    <>
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
        />
      </div>
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
      <div
        style={{ display: activeTab === "notifications" ? "block" : "none" }}
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
      {activeTab !== "tools" &&
        activeTab !== "prompts" &&
        activeTab !== "resources" &&
        activeTab !== "chat" &&
        activeTab !== "sampling" &&
        activeTab !== "elicitation" &&
        activeTab !== "notifications" && <>{children}</>}
    </>
  );
}
