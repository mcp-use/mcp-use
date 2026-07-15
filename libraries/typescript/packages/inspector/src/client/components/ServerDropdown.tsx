import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { ShimmerButton } from "@/client/components/ui/shimmer-button";
import { StatusDot } from "@/client/components/ui/status-dot";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { cn } from "@/client/lib/utils";
import { ChevronDown, Server } from "lucide-react";
import type { McpServer } from "@mcp-use/client/react";
import { useNavigate } from "react-router";
import { getServerDisplayName } from "@/client/utils/servers";
import { ServerHeaderAuthButton } from "./layout/ServerHeaderAuthButton";
import { ServerIcon } from "./ServerIcon";

type MCPConnection = McpServer;

interface ServerDropdownProps {
  connections: MCPConnection[];
  selectedServer: MCPConnection | undefined;
  onServerSelect: (serverId: string) => void;
  mobileMode?: boolean;
  /** Minimal inline style for breadcrumb headers (cloud-style). */
  variant?: "default" | "header";
}

export function ServerDropdown({
  connections,
  selectedServer,
  onServerSelect,
  mobileMode = false,
  variant = "default",
}: ServerDropdownProps) {
  const navigate = useNavigate();

  const handleServerSelect = (serverId: string) => {
    if (!connections.some((c) => c.id === serverId)) return;
    onServerSelect(serverId);
  };

  const dropdownMenu = (
    <DropdownMenuContent
      className="w-[calc(100vw-2rem)] sm:w-[300px]"
      align="start"
    >
      <DropdownMenuLabel
        className="cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800"
        onClick={() => navigate("/")}
      >
        MCP Servers
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      {connections.length === 0 ? (
        <div className="px-2 py-4 text-sm text-muted-foreground dark:text-zinc-400 text-center">
          No servers connected. Go to the dashboard to add one.
        </div>
      ) : (
        connections.map((connection) => (
          <DropdownMenuItem
            key={connection.id}
            onClick={() => handleServerSelect(connection.id)}
            className="flex items-center gap-3"
          >
            <ServerIcon server={connection} size="sm" />
            <div className="flex items-center gap-2 flex-1">
              <div className="font-medium">
                {getServerDisplayName(connection)}
              </div>
              <StatusDot status={connection.state} />
            </div>
          </DropdownMenuItem>
        ))
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => navigate("/")}>
        <span className="text-blue-600 dark:text-blue-400">
          + Add new server
        </span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  );

  if (mobileMode) {
    return (
      <div className="flex items-center gap-2">
        <div className="relative">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  className="h-11 px-2 bg-black dark:bg-white text-white dark:text-black border-black dark:border-white hover:bg-gray-800 dark:hover:bg-zinc-100 hover:border-gray-800 dark:hover:border-zinc-200 flex items-center gap-1.5"
                >
                  {selectedServer ? (
                    <ServerIcon server={selectedServer} size="md" />
                  ) : (
                    <Server className="h-5 w-5" />
                  )}
                  <ChevronDown className="h-4 w-4" />
                </Button>
              }
              nativeButton
            />
            {dropdownMenu}
          </DropdownMenu>
        </div>
      </div>
    );
  }

  if (variant === "header") {
    return (
      <div className="flex items-center gap-2 min-w-0">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className="flex items-center gap-2 min-w-0 cursor-pointer text-foreground transition-opacity hover:opacity-80"
              >
                {selectedServer && (
                  <ServerIcon server={selectedServer} size="sm" />
                )}
                <span className="truncate text-sm">
                  {selectedServer
                    ? getServerDisplayName(selectedServer)
                    : "Select server"}
                </span>
                {selectedServer && (
                  <>
                    <StatusDot status={selectedServer.state} />
                    <ServerHeaderAuthButton server={selectedServer} />
                  </>
                )}
                <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            }
            nativeButton
          />
          {dropdownMenu}
        </DropdownMenu>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <ShimmerButton
                className={cn(
                  "min-w-0 sm:min-w-[200px] p-0 px-1 text-sm h-11 justify-start text-white dark:text-black border-black dark:border-white hover:bg-gray-800 dark:hover:bg-zinc-100 hover:border-gray-800 dark:hover:border-zinc-200",
                  !selectedServer && "pl-4"
                )}
              >
                {selectedServer && (
                  <ServerIcon
                    server={selectedServer}
                    size="md"
                    className="mr-2"
                  />
                )}
                <div className="flex items-center gap-2 flex-1">
                  <span className="truncate lg:max-w-[120px] xl:max-w-none">
                    {selectedServer
                      ? getServerDisplayName(selectedServer)
                      : "Select server to inspect"}
                  </span>
                  {selectedServer && (
                    <div className="flex items-center gap-2">
                      {selectedServer.error &&
                      selectedServer.state !== "ready" ? (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                }}
                                className="w-2 h-2 rounded-full bg-rose-500 animate-status-pulse-red hover:bg-rose-600 transition-colors"
                                title="Click to copy error message"
                                aria-label="Copy error message to clipboard"
                              />
                            }
                            nativeButton
                          />
                          <TooltipContent>
                            <p className="max-w-xs">{selectedServer.error}</p>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <div
                          className={`w-2 h-2 rounded-full ${
                            selectedServer.state === "ready"
                              ? "bg-emerald-600 animate-status-pulse"
                              : selectedServer.state === "failed"
                                ? "bg-rose-600 animate-status-pulse-red"
                                : "bg-yellow-500 animate-status-pulse-yellow"
                          }`}
                        />
                      )}
                    </div>
                  )}
                </div>
              </ShimmerButton>
            }
            nativeButton
          />
          {dropdownMenu}
        </DropdownMenu>
      </div>
    </div>
  );
}
