import type { TabType } from "@/client/context/InspectorContext";
import { useInspector } from "@/client/context/InspectorContext";
import { useMcpContext } from "@/client/context/McpContext";
import { TooltipProvider } from "@/client/components/ui/tooltip";
import { useEffect, useRef, useState } from "react";
import { LayoutContent } from "./LayoutContent";
import { LayoutHeader } from "./LayoutHeader";

export interface ServerConfig {
  /** MCP server URL */
  url: string;
  /** Server display name */
  name?: string;
  /** Transport type */
  transportType?: "http" | "sse";
  /** Proxy configuration */
  proxyConfig?: {
    proxyAddress?: string;
    customHeaders?: Record<string, string>;
  };
  /** Custom headers for direct connection */
  customHeaders?: Record<string, string>;
  /** OAuth configuration */
  auth?: {
    type?: "oauth2";
    client_id?: string;
    redirect_url?: string;
    scope?: string;
  };
}

export interface InspectorProps {
  /** Pre-configured MCP server connection */
  serverConfig: ServerConfig;
  /** Tabs to show (if not specified, all tabs are shown) */
  showTabs?: TabType[];
  /** Optional backend API URL for features like chat (default: window.location.origin) */
  apiUrl?: string;
  /** Optional CSS class name */
  className?: string;
  /** Callback when connection state changes */
  onConnectionStateChange?: (state: {
    state: string;
    error?: string | null;
    tools?: any[];
    resources?: any[];
    prompts?: any[];
  }) => void;
  /** Initial active tab */
  initialTab?: TabType;
}

/**
 * Embeddable MCP Inspector component.
 *
 * This component provides a complete MCP server inspector interface
 * that can be embedded in any React application. It supports all
 * inspector features including tools, prompts, resources, chat,
 * sampling, elicitation, and notifications.
 *
 * @example
 * ```tsx
 * <Inspector
 *   serverConfig={{
 *     url: "https://example.com/mcp",
 *     name: "My Server",
 *     transportType: "http"
 *   }}
 *   showTabs={['tools', 'prompts', 'resources']}
 *   apiUrl="https://api.example.com"
 * />
 * ```
 */
export function Inspector({
  serverConfig,
  showTabs,
  apiUrl = typeof window !== "undefined" ? window.location.origin : "",
  className = "",
  onConnectionStateChange,
  initialTab = "tools",
}: InspectorProps) {
  const { connections, configLoaded } = useMcpContext();
  const { selectedServerId, setSelectedServerId, activeTab, setActiveTab } =
    useInspector();

  const [hasInitialized, setHasInitialized] = useState(false);

  // Refs for search inputs in tabs
  const toolsSearchRef = useRef<{
    focusSearch: () => void;
    blurSearch: () => void;
  } | null>(null);
  const promptsSearchRef = useRef<{
    focusSearch: () => void;
    blurSearch: () => void;
  } | null>(null);
  const resourcesSearchRef = useRef<{
    focusSearch: () => void;
    blurSearch: () => void;
  } | null>(null);

  // Store apiUrl in a ref or context for components that need it
  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as any).__INSPECTOR_API_URL__ = apiUrl;
    }
  }, [apiUrl]);

  // Initialize with the first connection (should only be one in embedded mode)
  useEffect(() => {
    if (configLoaded && connections.length > 0 && !hasInitialized) {
      setSelectedServerId(connections[0].id);
      setActiveTab(initialTab);
      setHasInitialized(true);
    }
  }, [
    configLoaded,
    connections,
    hasInitialized,
    setSelectedServerId,
    setActiveTab,
    initialTab,
  ]);

  // Get the selected server (should be the only connection)
  const selectedServer = connections.find((c) => c.id === selectedServerId);

  // Notify parent about connection state changes
  useEffect(() => {
    if (selectedServer && onConnectionStateChange) {
      onConnectionStateChange({
        state: selectedServer.state,
        error: selectedServer.error,
        tools: selectedServer.tools,
        resources: selectedServer.resources,
        prompts: selectedServer.prompts,
      });
    }
  }, [
    selectedServer?.state,
    selectedServer?.error,
    selectedServer?.tools,
    selectedServer?.resources,
    selectedServer?.prompts,
    onConnectionStateChange,
  ]);

  // If no server yet, show loading or empty state
  if (!selectedServer) {
    return (
      <div className={`h-full flex items-center justify-center ${className}`}>
        <div className="text-center">
          <p className="text-sm text-muted-foreground">
            Connecting to MCP server...
          </p>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className={`h-full flex flex-col ${className}`}>
        {/* Header - simplified for embedded mode */}
        <LayoutHeader
          connections={connections}
          selectedServer={selectedServer}
          activeTab={activeTab}
          onServerSelect={() => {}} // No server selection in embedded mode
          onTabChange={setActiveTab}
          onCommandPaletteOpen={() => {}} // Disabled in embedded mode
          onOpenConnectionOptions={() => {}} // Disabled in embedded mode
          embedded={true}
          showTabs={showTabs}
        />

        {/* Main Content */}
        <main className="flex-1 overflow-auto bg-white dark:bg-black">
          <LayoutContent
            selectedServer={selectedServer}
            activeTab={activeTab}
            toolsSearchRef={toolsSearchRef}
            promptsSearchRef={promptsSearchRef}
            resourcesSearchRef={resourcesSearchRef}
          >
            {/* Empty children for embedded mode */}
            <div />
          </LayoutContent>
        </main>
      </div>
    </TooltipProvider>
  );
}
