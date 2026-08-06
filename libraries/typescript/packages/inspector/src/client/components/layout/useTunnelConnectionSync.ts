import {
  getStoredConnectionConfig,
  toEditableConnectionConfig,
  toMcpServerConfig,
  type EditableConnectionConfig,
} from "@/client/utils/connectionUpdates";
import { isLocalhostServerUrl } from "@/client/utils/servers";
import type { McpServer, McpServerConfig } from "@mcp-use/client/react";
import { useEffect, useRef, useState } from "react";

export function resolveLocalTunnelRecoveryTarget(
  currentUrl: string,
  localhostMcpUrl: string | null
): string | null {
  if (
    !localhostMcpUrl ||
    !isLocalhostServerUrl(localhostMcpUrl) ||
    isLocalhostServerUrl(currentUrl) ||
    currentUrl === localhostMcpUrl
  ) {
    return null;
  }
  return localhostMcpUrl;
}

/**
 * Recover localhost connections rewritten by the legacy tunnel-switching
 * behavior. The Inspector keeps using its same-origin local endpoint while a
 * public tunnel is active; the tunnel URL is only displayed and shared with
 * external clients.
 */
export function useTunnelConnectionSync({
  selectedServerId,
  selectedServer,
  configLoaded,
  removeConnection,
  updateConnection,
  connections,
}: {
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
    const targetUrl = resolveLocalTunnelRecoveryTarget(
      currentUrl,
      localhostMcpRef.current
    );

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
    updateConnection,
  ]);

  useEffect(() => {
    if (!isTunnelConnecting) {
      syncingRef.current = false;
    }
  }, [isTunnelConnecting]);

  return isTunnelConnecting;
}
