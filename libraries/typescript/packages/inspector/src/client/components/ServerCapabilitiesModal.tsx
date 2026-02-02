import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import type { McpServer } from "mcp-use/react";
import { JSONDisplay } from "./shared/JSONDisplay";

// Type alias for backward compatibility
type MCPConnection = McpServer;

interface ServerCapabilitiesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connection: MCPConnection | null;
}

/**
 * Render a modal that displays server information and the server's capabilities JSON.
 *
 * @param open - Controls whether the modal is visible
 * @param onOpenChange - Callback invoked when the modal open state changes
 * @param connection - The server connection whose info and capabilities are shown; if `null`, nothing is rendered
 * @returns A JSX element containing the server information and capabilities viewer, or `null` when `connection` is `null`
 */
export function ServerCapabilitiesModal({
  open,
  onOpenChange,
  connection,
}: ServerCapabilitiesModalProps) {
  if (!connection) return null;

  const capabilities = connection.capabilities || {};

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl max-h-[80vh] overflow-y-auto"
        data-testid="server-info-modal"
      >
        <DialogHeader>
          <DialogTitle
            className="flex items-center gap-2"
            data-testid="server-info-modal-title"
          >
            Server Information
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Server Info Section */}
          <div className="space-y-3 pb-4 border-b">
            <div className="space-y-2">
              <div className="space-y-2">
                {connection.serverInfo?.title && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium min-w-[80px]">
                      Title:
                    </span>
                    <span className="text-xs font-mono bg-muted rounded-md p-1 px-2">
                      {connection.serverInfo.title}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium min-w-[80px]">
                    Name:
                  </span>
                  <span
                    className="text-xs font-mono bg-muted rounded-md p-1 px-2"
                    data-testid="server-info-name"
                  >
                    {connection.serverInfo?.name || connection.name}
                  </span>
                </div>
                {connection.serverInfo?.version && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium min-w-[80px]">
                      Version:
                    </span>
                    <span className="text-xs font-mono bg-muted rounded-md p-1 px-2">
                      {connection.serverInfo.version}
                    </span>
                  </div>
                )}
                {connection.serverInfo?.websiteUrl && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium min-w-[80px]">
                      Website:
                    </span>
                    <a
                      href={connection.serverInfo.websiteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-500 hover:underline"
                    >
                      {connection.serverInfo.websiteUrl}
                    </a>
                  </div>
                )}
                {connection.serverInfo?.icons &&
                  connection.serverInfo.icons.length > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium min-w-[80px]">
                        Icons:
                      </span>
                      <div className="flex gap-2">
                        {connection.serverInfo.icons.map(
                          (icon: any, idx: number) => (
                            <span
                              key={idx}
                              className="text-xs bg-muted rounded-md p-1 px-2"
                            >
                              {icon.src} ({icon.sizes?.join(", ") || "no size"})
                            </span>
                          )
                        )}
                      </div>
                    </div>
                  )}
              </div>
            </div>
          </div>

          {/* Capabilities Section */}
          <div className="space-y-3">
            <h3 className="font-semibold text-sm text-muted-foreground">
              Capabilities
            </h3>

            <div data-testid="server-info-capabilities">
              <JSONDisplay
                data={capabilities}
                filename={`capabilities-${connection.name}-${Date.now()}.json`}
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
