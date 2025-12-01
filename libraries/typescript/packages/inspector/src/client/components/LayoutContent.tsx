import type { ReactNode, RefObject } from "react";
import type { MCPConnection } from "@/client/context/McpContext";
import { ChatTab } from "./ChatTab";
import { NotificationsTab } from "./NotificationsTab";
import { PromptsTab } from "./PromptsTab";
import { ResourcesTab } from "./ResourcesTab";
import { ToolsTab } from "./ToolsTab";
import { SamplingTab } from "./SamplingTab";

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
          ref={toolsSearchRef}
          tools={selectedServer.tools}
          callTool={selectedServer.callTool}
          readResource={selectedServer.readResource}
          serverId={selectedServer.id}
          isConnected={selectedServer.state === "ready"}
        />
      </div>
      <div
        style={{ display: activeTab === "prompts" ? "block" : "none" }}
        className="h-full"
      >
        <PromptsTab
          ref={promptsSearchRef}
          prompts={selectedServer.prompts}
          callPrompt={selectedServer.getPrompt}
          serverId={selectedServer.id}
          isConnected={selectedServer.state === "ready"}
        />
      </div>
      <div
        style={{ display: activeTab === "resources" ? "block" : "none" }}
        className="h-full"
      >
        <ResourcesTab
          ref={resourcesSearchRef}
          resources={selectedServer.resources}
          readResource={selectedServer.readResource}
          serverId={selectedServer.id}
          isConnected={selectedServer.state === "ready"}
        />
      </div>
      <div
        style={{ display: activeTab === "chat" ? "block" : "none" }}
        className="h-full"
      >
        <ChatTab
          key={selectedServer.id}
          connection={selectedServer}
          isConnected={selectedServer.state === "ready"}
          readResource={selectedServer.readResource}
        />
      </div>
      <div
        style={{ display: activeTab === "sampling" ? "block" : "none" }}
        className="h-full"
      >
        <SamplingTab
          pendingRequests={selectedServer.pendingSamplingRequests}
          onApprove={selectedServer.approveSampling}
          onReject={selectedServer.rejectSampling}
          serverId={selectedServer.id}
          isConnected={selectedServer.state === "ready"}
          mcpServerUrl={selectedServer.url}
        />
      </div>
      <div
        style={{ display: activeTab === "notifications" ? "block" : "none" }}
        className="h-full"
      >
        <NotificationsTab
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
        activeTab !== "notifications" && <>{children}</>}
    </>
  );
}
