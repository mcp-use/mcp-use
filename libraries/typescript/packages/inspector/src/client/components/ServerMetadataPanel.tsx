import type { ReactNode } from "react";
import { ServerCapabilitiesList } from "@/client/components/ServerCapabilitiesList";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/client/components/ui/card";
import { Label } from "@/client/components/ui/label";
import { getConfiguredServerAlias } from "@/client/utils/servers";
import type { McpServer } from "@mcp-use/client/react";

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
      <div className="min-h-4 text-xs font-mono" data-testid={testId}>
        {children}
      </div>
    </div>
  );
}

export function ServerMetadataPanel({
  connection,
  inDialog = false,
}: ServerMetadataPanelProps) {
  const alias = getConfiguredServerAlias(connection);
  const canonicalName =
    connection.serverInfo?.name ||
    connection.serverInfo?.title ||
    connection.url ||
    connection.name;

  return (
    <div className="space-y-6">
      <Card className="border">
        <CardHeader>
          <CardTitle className="text-base font-medium">
            {inDialog ? "General" : "Server Information"}
          </CardTitle>
          <CardDescription>Server identity from initialize</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
            {connection.serverInfo?.title && (
              <MetadataField label="Title">
                <span className="inline-block rounded-md bg-muted p-1 px-2">
                  {connection.serverInfo.title}
                </span>
              </MetadataField>
            )}
            {alias && (
              <MetadataField label="Alias">
                <span className="inline-block rounded-md bg-muted p-1 px-2">
                  {alias}
                </span>
              </MetadataField>
            )}
            <MetadataField label="Name" testId="server-info-name">
              <span className="inline-block rounded-md bg-muted p-1 px-2">
                {canonicalName}
              </span>
            </MetadataField>
            {connection.serverInfo?.version && (
              <MetadataField label="Version">
                <span className="inline-block rounded-md bg-muted p-1 px-2">
                  {connection.serverInfo.version}
                </span>
              </MetadataField>
            )}
            {connection.protocolVersion && (
              <MetadataField label="Protocol">
                <span className="inline-block rounded-md bg-muted p-1 px-2">
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
                  className="break-all font-sans text-blue-500 hover:underline"
                >
                  {connection.serverInfo.websiteUrl}
                </a>
              </MetadataField>
            )}
          </div>
        </CardContent>
      </Card>

      {connection.instructions && (
        <Card className="border">
          <CardHeader>
            <CardTitle className="text-base font-medium">Instructions</CardTitle>
            <CardDescription>
              Server guidance for clients and agents
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="whitespace-pre-wrap font-sans text-sm text-muted-foreground">
              {connection.instructions}
            </p>
          </CardContent>
        </Card>
      )}

      {connection.serverInfo?.icons &&
        connection.serverInfo.icons.length > 0 && (
          <Card className="border">
            <CardHeader>
              <CardTitle className="text-base font-medium">Icons</CardTitle>
              <CardDescription>Server icon assets from initialize</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex flex-col gap-2 font-sans">
                {connection.serverInfo.icons.map(
                  (icon: { src: string; sizes?: string[] }, idx: number) => (
                    <div
                      key={idx}
                      className="flex min-w-0 items-center gap-2 rounded-md bg-muted p-2"
                      data-testid={`server-info-icon-${idx}`}
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-background">
                        <img
                          src={icon.src}
                          alt={`Server icon ${idx + 1}`}
                          className="h-full w-full object-contain"
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
            </CardContent>
          </Card>
        )}

      <Card className="border" data-testid="server-info-capabilities">
        <CardHeader>
          <CardTitle className="text-base font-medium">Capabilities</CardTitle>
          <CardDescription>
            MCP capabilities reported during initialize
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <ServerCapabilitiesList connection={connection} />
        </CardContent>
      </Card>
    </div>
  );
}
