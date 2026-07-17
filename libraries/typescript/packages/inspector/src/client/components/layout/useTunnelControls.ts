import {
  MCPTunnelActionEvent,
  captureInspectorEvent,
} from "@/client/telemetry";
import { inspectorApi } from "@/client/utils/basePath";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { tunnelOriginFromMcpUrl } from "./layoutHeaderUtils";
import { copyToClipboardSync } from "@/client/utils/browser";

interface DevInfo {
  fromCli?: boolean;
  tunnelUrl?: string | null;
  mcpUrl?: string | null;
}

async function fetchDevInfo(): Promise<DevInfo | null> {
  try {
    const res = await fetch(inspectorApi("dev/info"));
    if (!res.ok) return null;
    return (await res.json()) as DevInfo;
  } catch {
    return null;
  }
}

/** `dev/info` exists only under `mcp-use dev`; standalone `pnpm start` has no route. */
function hasDevCliApi(): boolean {
  if (typeof window === "undefined") return false;
  return (
    (window as { __MCP_INSPECTOR_MODE__?: string }).__MCP_INSPECTOR_MODE__ !==
    "standalone"
  );
}

export function useTunnelControls({
  tunnelUrl,
  setTunnelUrl,
  isTunnelStarting,
  setIsTunnelStarting,
  onTunnelStarted,
}: {
  tunnelUrl: string | null;
  setTunnelUrl: (url: string | null) => void;
  isTunnelStarting: boolean;
  setIsTunnelStarting: (starting: boolean) => void;
  onTunnelStarted?: () => void;
}) {
  const [devFromCli, setDevFromCli] = useState<boolean | null>(null);
  const [mcpUrl, setMcpUrl] = useState<string | null>(null);
  const [waitTicks, setWaitTicks] = useState(0);

  const applyDevInfo = useCallback(
    (info: DevInfo, options?: { syncTunnel?: boolean }) => {
      const syncTunnel = options?.syncTunnel ?? false;
      setDevFromCli(!!info.fromCli);
      if (info.mcpUrl) {
        setMcpUrl(info.mcpUrl);
      }
      if (!syncTunnel) return;
      if (info.tunnelUrl) {
        setTunnelUrl(new URL(info.tunnelUrl).origin);
        return;
      }
      const origin = tunnelOriginFromMcpUrl(info.mcpUrl ?? null);
      if (origin) {
        setTunnelUrl(origin);
        return;
      }
      setTunnelUrl(null);
    },
    [setTunnelUrl]
  );

  useEffect(() => {
    if (!isTunnelStarting) {
      setWaitTicks(20);
      return;
    }
    setWaitTicks(20);
    const id = setInterval(
      () => setWaitTicks((t) => (t > 0 ? t - 1 : 0)),
      1000
    );
    return () => clearInterval(id);
  }, [isTunnelStarting]);

  useEffect(() => {
    let cancelled = false;
    if (!hasDevCliApi()) {
      setDevFromCli(false);
      return;
    }
    (async () => {
      const info = await fetchDevInfo();
      if (cancelled) return;
      if (info) {
        applyDevInfo(info, { syncTunnel: true });
      } else {
        setDevFromCli(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyDevInfo]);

  const handleStartTunnel = useCallback(async () => {
    if (devFromCli === false) {
      toast.error(
        "Start Tunnel requires `mcp-use dev` from your project directory."
      );
      return;
    }
    setIsTunnelStarting(true);
    let success = false;
    try {
      const res = await fetch(inspectorApi("dev/start-tunnel"), {
        method: "POST",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        toast.error(data.error || "Failed to start tunnel");
        return;
      }
      const info = await fetchDevInfo();
      if (info?.tunnelUrl || info?.mcpUrl) {
        applyDevInfo(info, { syncTunnel: true });
        const urlToCopy =
          info.mcpUrl ??
          (info.tunnelUrl ? `${info.tunnelUrl.replace(/\/+$/, "")}/mcp` : null);
        if (urlToCopy) {
          copyToClipboardSync(urlToCopy);
        }
        onTunnelStarted?.();
      }
      success = true;
    } catch {
      toast.error("Failed to start tunnel");
    } finally {
      setIsTunnelStarting(false);
    }
    try {
      captureInspectorEvent(
        new MCPTunnelActionEvent({ action: "start", success })
      ).catch(() => {});
    } catch {
      // ignore telemetry errors
    }
  }, [applyDevInfo, devFromCli, onTunnelStarted, setIsTunnelStarting]);

  const handleStopTunnel = useCallback(async () => {
    setIsTunnelStarting(true);
    let success = false;
    try {
      const res = await fetch(inspectorApi("dev/stop-tunnel"), {
        method: "POST",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        toast.error(data.error || "Failed to stop tunnel");
        return;
      }
      setTunnelUrl(null);
      setMcpUrl(null);
      toast.success("Tunnel stopped");
      success = true;
    } catch {
      toast.error("Failed to stop tunnel");
    } finally {
      setIsTunnelStarting(false);
    }
    try {
      captureInspectorEvent(
        new MCPTunnelActionEvent({
          action: "stop",
          success,
          tunnelUrl,
        })
      ).catch(() => {});
    } catch {
      // ignore telemetry errors
    }
  }, [setIsTunnelStarting, setTunnelUrl, tunnelUrl]);

  return {
    devFromCli,
    mcpUrl,
    waitTicks,
    handleStartTunnel,
    handleStopTunnel,
  };
}
