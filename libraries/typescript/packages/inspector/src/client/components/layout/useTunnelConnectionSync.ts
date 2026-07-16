import { getBasePath } from "@/client/utils/basePath";
import {
  getStoredConnectionConfig,
  toEditableConnectionConfig,
  toMcpServerConfig,
  type EditableConnectionConfig,
} from "@/client/utils/connectionUpdates";
import { isLocalhostServerUrl } from "@/client/utils/servers";
import type { McpServer, McpServerConfig } from "@mcp-use/client/react";
import { useEffect, useRef, useState } from "react";
import { isMcpUseTunnelUrl } from "./layoutHeaderUtils";

function tunnelMcpFromOrigin(tunnelUrl: string): string {
  return `${tunnelUrl.replace(/\/+$/, "")}${getBasePath()}`;
}

/**
 * When dev tunnel is active, reconnect the selected localhost server to the
 * tunnel MCP endpoint (and back when the tunnel stops).
 */
export function useTunnelConnectionSync({
  tunnelUrl,
  tunnelMcpUrl,
  selectedServerId,
  selectedServer,
  configLoaded,
  removeConnection,
  updateConnection,
  connections,
}: {
  tunnelUrl: string | null;
  tunnelMcpUrl?: string | null;
  selectedServerId: string | null;
  selectedServer: McpServer | undefined;
  configLoaded: boolean;
  removeConnection: (id: string) => Promise<void>;
  updateConnection: (
    id: string,
    config: Partial<McpServerConfig>
  ) => Promise<void>;
  connections: McpServer[];
}) {
  const localhostMcpRef = useRef<string | null>(null);
  const syncingRef = useRef(false);
  const switchTargetRef = useRef<string | null>(null);
  const [isTunnelConnecting, setIsTunnelConnecting] = useState(false);

  useEffect(() => {
    if (
      !isTunnelConnecting ||
      selectedServer?.url !== switchTargetRef.current ||
      (selectedServer.state !== "ready" && selectedServer.state !== "failed")
    ) {
      return;
    }
    setIsTunnelConnecting(false);
    syncingRef.current = false;
    switchTargetRef.current = null;
  }, [isTunnelConnecting, selectedServer]);

  useEffect(() => {
    if (selectedServerId && isLocalhostServerUrl(selectedServerId)) {
      localhostMcpRef.current = selectedServerId;
    } else if (
      selectedServer?.url &&
      isLocalhostServerUrl(selectedServer.url)
    ) {
      localhostMcpRef.current = selectedServer.url;
    }
  }, [selectedServer?.url, selectedServerId]);

  useEffect(() => {
    if (
      !configLoaded ||
      !selectedServerId ||
      !selectedServer ||
      syncingRef.current
    ) {
      return;
    }

    const currentUrl = selectedServer.url ?? "";
    const onLocalhost = isLocalhostServerUrl(currentUrl);
    const onTunnel = isMcpUseTunnelUrl(currentUrl);
    const tunnelMcp =
      tunnelMcpUrl ?? (tunnelUrl ? tunnelMcpFromOrigin(tunnelUrl) : null);

    let targetUrl: string | null = null;
    if (tunnelUrl && tunnelMcp && onLocalhost) {
      targetUrl = tunnelMcp;
    } else if (!tunnelUrl && onTunnel && localhostMcpRef.current) {
      targetUrl = localhostMcpRef.current;
    }

    if (!targetUrl || targetUrl === currentUrl) return;

    syncingRef.current = true;
    switchTargetRef.current = targetUrl;
    setIsTunnelConnecting(true);
    void (async () => {
      try {
        // Remove tunnel entries persisted by the previous ID-swapping
        // implementation; addServer would otherwise keep their failed state.
        if (
          targetUrl !== selectedServerId &&
          connections.some((connection) => connection.id === targetUrl)
        ) {
          await removeConnection(targetUrl);
        }

        const stored =
          getStoredConnectionConfig<EditableConnectionConfig>(
            selectedServerId
          ) ?? toEditableConnectionConfig(selectedServer);
        const nextConfig: EditableConnectionConfig = {
          ...stored,
          url: targetUrl,
        };
        await updateConnection(selectedServerId, toMcpServerConfig(nextConfig));
      } catch {
        setIsTunnelConnecting(false);
        switchTargetRef.current = null;
        syncingRef.current = false;
      }
    })();
  }, [
    configLoaded,
    connections,
    removeConnection,
    selectedServer,
    selectedServerId,
    tunnelMcpUrl,
    tunnelUrl,
    updateConnection,
  ]);

  useEffect(() => {
    if (!isTunnelConnecting) {
      syncingRef.current = false;
    }
  }, [isTunnelConnecting]);

  return isTunnelConnecting;
}
