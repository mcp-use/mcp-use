import { AlertCircle, RefreshCw } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/client/components/ui/button";

interface McpReconnectBannerProps {
  serverName?: string;
  serverUrl: string;
  message?: string;
  onReconnect: () => Promise<void> | void;
  onDismiss?: () => void;
}

export function McpReconnectBanner({
  serverName,
  serverUrl,
  message,
  onReconnect,
  onDismiss,
}: McpReconnectBannerProps) {
  const [isReconnecting, setIsReconnecting] = useState(false);

  const handleClick = useCallback(async () => {
    setIsReconnecting(true);
    try {
      await onReconnect();
    } finally {
      setIsReconnecting(false);
    }
  }, [onReconnect]);

  let label = serverName;
  if (!label) {
    try {
      label = new URL(serverUrl).host;
    } catch {
      label = serverUrl;
    }
  }

  return (
    <div className="w-full flex justify-center items-center px-2 sm:px-4 mb-2">
      <div
        role="alert"
        className="w-full max-w-3xl flex items-start gap-3 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-100"
      >
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="flex-1 min-w-0">
          <div className="font-medium">
            Reconnect to <span className="font-semibold">{label}</span>
          </div>
          <div className="text-xs opacity-90">
            {message ??
              "The MCP server rejected your credentials. Reconnect to refresh them."}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="default"
            onClick={handleClick}
            disabled={isReconnecting}
          >
            <RefreshCw
              className={`size-3.5 ${isReconnecting ? "animate-spin" : ""}`}
              aria-hidden
            />
            {isReconnecting ? "Reconnecting…" : "Reconnect"}
          </Button>
          {onDismiss && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onDismiss}
              aria-label="Dismiss"
            >
              Dismiss
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
