import type { ReactNode } from "react";
import { ServerCapabilitiesList } from "@/client/components/ServerCapabilitiesList";
import { Button } from "@/client/components/ui/button";
import { Label } from "@/client/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/client/components/ui/tooltip";
import { copyToClipboard } from "@/client/utils/browser";
import { getConfiguredServerAlias } from "@/client/utils/servers";
import type { McpServer } from "@mcp-use/client/react";
import { Copy } from "lucide-react";
import { toast } from "sonner";

interface ServerMetadataPanelProps {
  connection: McpServer;
  inDialog?: boolean;
}

const metadataCell = "space-y-1.5 min-w-0";

function MetadataField({
  label,
  children,
  className,
  testId,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div className={className ?? metadataCell}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="text-xs font-mono min-h-4" data-testid={testId}>
        {children}
      </div>
    </div>
  );
}

export function ServerMetadataPanel({
  connection,
  inDialog: _inDialog,
}: ServerMetadataPanelProps) {
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
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <div className="space-y-4 min-w-0">
        <Label className="text-sm font-medium">Server Information</Label>
        <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
          {connection.serverInfo?.title && (
            <MetadataField label="Title">
              <span className="bg-muted rounded-md p-1 px-2 inline-block">
                {connection.serverInfo.title}
              </span>
            </MetadataField>
          )}
          {alias && (
            <MetadataField label="Alias">
              <span className="bg-muted rounded-md p-1 px-2 inline-block">
                {alias}
              </span>
            </MetadataField>
          )}
          <MetadataField label="Name" testId="server-info-name">
            <span className="bg-muted rounded-md p-1 px-2 inline-block">
              {canonicalName}
            </span>
          </MetadataField>
          {connection.url && (
            <MetadataField label="URL" className={`${metadataCell} w-full`}>
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="bg-muted rounded-md p-1 px-2 overflow-x-auto min-w-0 max-w-full inline-block"
                  data-testid="server-info-url"
                >
                  {connection.url}
                </span>
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
            </MetadataField>
          )}
          {connection.serverInfo?.version && (
            <MetadataField label="Version">
              <span className="bg-muted rounded-md p-1 px-2 inline-block">
                {connection.serverInfo.version}
              </span>
            </MetadataField>
          )}
          {connection.protocolVersion && (
            <MetadataField label="Protocol">
              <span className="bg-muted rounded-md p-1 px-2 inline-block">
                {connection.protocolVersion}
              </span>
            </MetadataField>
          )}
          {connection.serverInfo?.websiteUrl && (
            <MetadataField label="Website" className={`${metadataCell} w-full`}>
              <a
                href={connection.serverInfo.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:underline break-all"
              >
                {connection.serverInfo.websiteUrl}
              </a>
            </MetadataField>
          )}
          {connection.instructions && (
            <MetadataField label="Instructions" className={`${metadataCell} w-full`}>
              <p className="text-muted-foreground whitespace-pre-wrap font-sans">
                {connection.instructions}
              </p>
            </MetadataField>
          )}
          {connection.serverInfo?.icons &&
            connection.serverInfo.icons.length > 0 && (
              <MetadataField label="Icons" className={`${metadataCell} w-full`}>
                <div className="flex flex-col gap-2 font-sans">
                  {connection.serverInfo.icons.map(
                    (icon: { src: string; sizes?: string[] }, idx: number) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 bg-muted rounded-md p-2 min-w-0"
                        data-testid={`server-info-icon-${idx}`}
                      >
                        <div className="w-8 h-8 shrink-0 rounded-md overflow-hidden bg-background flex items-center justify-center border border-border">
                          <img
                            src={icon.src}
                            alt={`Server icon ${idx + 1}`}
                            className="w-full h-full object-contain"
                          />
                        </div>
                        <div className="min-w-0 text-xs">
                          <p className="truncate font-mono">{icon.src}</p>
                          <p className="text-muted-foreground">
                            {icon.sizes?.join(", ") || "no size"}
                          </p>
                        </div>
                      </div>
                    )
                  )}
                </div>
              </MetadataField>
            )}
        </div>
      </div>

      <ServerCapabilitiesList connection={connection} />
    </div>
  );
}
