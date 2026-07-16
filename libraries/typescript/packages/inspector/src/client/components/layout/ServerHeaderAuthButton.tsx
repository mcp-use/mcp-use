import { Button } from "@/client/components/ui/button";
import { INSPECTOR_RECONNECT_STORAGE_KEY } from "@/client/hooks/useAutoConnect";
import { cn } from "@/client/lib/utils";
import type { McpServer } from "@mcp-use/client/react";
import { Loader2 } from "lucide-react";

const AUTH_BUTTON_CLASS =
  "h-6 px-2 text-xs bg-yellow-500/20 border-0 dark:bg-yellow-400/10 text-yellow-800 dark:text-yellow-500 shrink-0";

function storeReconnectSession(server: McpServer) {
  try {
    sessionStorage.setItem(
      INSPECTOR_RECONNECT_STORAGE_KEY,
      JSON.stringify({
        url: server.url,
        name: server.name || "Auto-connected Server",
        transportType: (server as { transportType?: string }).transportType || "http",
        connectionMode: "auto",
      })
    );
  } catch {
    /* sessionStorage unavailable — best-effort */
  }
}

/** Compact Authenticate / Authenticating control for the inspector server header. */
export function ServerHeaderAuthButton({
  server,
  className,
}: {
  server: McpServer;
  className?: string;
}) {
  const { state, authUrl, authenticate } = server;

  if (state !== "pending_auth" && state !== "authenticating") {
    return null;
  }

  if (state === "authenticating") {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled
        className={cn(AUTH_BUTTON_CLASS, className)}
      >
        <Loader2 className="h-3 w-3 animate-spin mr-1" />
        Authenticating
      </Button>
    );
  }

  if (authenticate) {
    return (
      <Button
        data-testid="server-header-authenticate"
        size="sm"
        variant="outline"
        className={cn(AUTH_BUTTON_CLASS, className)}
        onClick={(e) => {
          e.stopPropagation();
          storeReconnectSession(server);
          void authenticate();
        }}
      >
        Authenticate
      </Button>
    );
  }

  if (authUrl) {
    return (
      <Button
        size="sm"
        variant="outline"
        className={cn(AUTH_BUTTON_CLASS, className)}
        render={
          <a
            href={authUrl}
            data-testid="server-header-authenticate"
            onClick={(e) => {
              e.stopPropagation();
              storeReconnectSession(server);
            }}
          />
        }
        nativeButton={false}
      >
        Authenticate
      </Button>
    );
  }

  return null;
}
