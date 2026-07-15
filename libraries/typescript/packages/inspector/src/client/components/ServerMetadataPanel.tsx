import { Button } from "@/client/components/ui/button";
import { DialogJsonSection } from "@/client/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/client/components/ui/tooltip";
import { copyToClipboard } from "@/client/utils/browser";
import {
  getConfiguredServerAlias,
  getServerDisplayName,
} from "@/client/utils/servers";
import type { McpServer } from "@mcp-use/client/react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { JSONDisplay } from "./shared/JSONDisplay";

interface ServerMetadataPanelProps {
  connection: McpServer;
  inDialog?: boolean;
}

export function ServerMetadataPanel({
  connection,
  inDialog,
}: ServerMetadataPanelProps) {
  const capabilities = connection.capabilities || {};
  const alias = getConfiguredServerAlias(connection);
  const canonicalName =
    connection.serverInfo?.name ||
    connection.serverInfo?.title ||
    connection.url ||
    connection.name;

  const copyUrl = async () => {
    if (connection.url) {
      await copyToClipboard(connection.url);
      toast.success("URL copied");
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="space-y-2">
          <div className="space-y-4">
            {connection.serverInfo?.title && (
              <div className="flex flex-col items-start gap-2">
                <span className="text-sm font-medium min-w-[80px]">Title</span>
                <span className="text-xs font-mono bg-muted rounded-md p-1 px-2">
                  {connection.serverInfo.title}
                </span>
              </div>
            )}
            {alias && (
              <div className="flex flex-col items-start gap-2">
                <span className="text-sm font-medium shrink-0">Alias</span>
                <span className="text-xs font-mono bg-muted rounded-md p-1 px-2">
                  {alias}
                </span>
              </div>
            )}
            <div className="flex flex-col items-start gap-2">
              <span className="text-sm font-medium shrink-0">Name</span>
              <span
                className="text-xs font-mono bg-muted rounded-md p-1 px-2"
                data-testid="server-info-name"
              >
                {canonicalName}
              </span>
            </div>
            {connection.url && (
              <div className="flex flex-col items-start gap-2 min-w-0">
                <span className="text-sm font-medium min-w-[80px] shrink-0">
                  URL
                </span>
                <div className="flex items-center gap-2">
                  <div
                    className="text-xs font-mono bg-muted rounded-md p-1 px-2 overflow-x-auto min-w-0 max-w-2xl"
                    data-testid="server-info-url"
                  >
                    {connection.url}
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={copyUrl}
                        aria-label="Copy URL"
                        data-testid="server-info-copy-url"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Copy URL</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            )}
            {connection.serverInfo?.version && (
              <div className="flex flex-col items-start gap-2">
                <span className="text-sm font-medium min-w-[80px]">
                  Version
                </span>
                <span className="text-xs font-mono bg-muted rounded-md p-1 px-2">
                  {connection.serverInfo.version}
                </span>
              </div>
            )}
            {connection.protocolVersion && (
              <div className="flex flex-col items-start gap-2">
                <span className="text-sm font-medium min-w-[80px]">
                  Protocol
                </span>
                <span className="text-xs font-mono bg-muted rounded-md p-1 px-2">
                  {connection.protocolVersion}
                </span>
              </div>
            )}
            {connection.serverInfo?.websiteUrl && (
              <div className="flex flex-col items-start gap-2">
                <span className="text-sm font-medium min-w-[80px]">
                  Website
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
            {connection.instructions && (
              <div className="flex flex-col items-start gap-2">
                <span className="text-sm font-medium min-w-[80px]">
                  Instructions
                </span>
                <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                  {connection.instructions}
                </p>
              </div>
            )}
            {connection.serverInfo?.icons &&
              connection.serverInfo.icons.length > 0 && (
                <div className="flex flex-col items-start gap-2">
                  <span className="text-sm font-medium min-w-[80px]">
                    Icons
                  </span>
                  <div className="flex gap-2">
                    {connection.serverInfo.icons.map(
                      (icon: { src: string; sizes?: string[] }, idx: number) => (
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

      <div className="space-y-3">
        <h3 className="text-sm font-medium">Capabilities</h3>
        <div data-testid="server-info-capabilities">
          {inDialog ? (
            <DialogJsonSection>
              <JSONDisplay
                data={capabilities}
                filename={`capabilities-${getServerDisplayName(connection)}-${Date.now()}.json`}
              />
            </DialogJsonSection>
          ) : (
            <JSONDisplay
              data={capabilities}
              filename={`capabilities-${getServerDisplayName(connection)}-${Date.now()}.json`}
            />
          )}
        </div>
      </div>
    </div>
  );
}
