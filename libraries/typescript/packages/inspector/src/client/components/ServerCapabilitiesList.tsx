import { Badge } from "@/client/components/ui/badge";
import { Label } from "@/client/components/ui/label";
import {
  buildServerCapabilityRows,
  type CapabilityRow,
} from "@/client/utils/serverCapabilities";
import type { McpServer } from "@mcp-use/client/react";

interface ServerCapabilitiesListProps {
  connection: McpServer;
}

function CapabilityRowView({ row }: { row: CapabilityRow }) {
  return (
    <div
      className="space-y-1.5"
      data-testid={`capability-${row.id}`}
      data-supported={row.supported ? "true" : "false"}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">{row.label}</span>
        {row.supported ? (
          <Badge color="blue" size="sm">
            Supported
          </Badge>
        ) : (
          <Badge variant="outline" color="gray" size="sm">
            Not supported
          </Badge>
        )}
      </div>
      {row.supported && row.features.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pl-0.5">
          {row.features.map((feature) => (
            <Badge
              key={feature.id}
              color="blue"
              size="sm"
              data-testid={`capability-feature-${row.id}-${feature.id}`}
            >
              {feature.label}
            </Badge>
          ))}
        </div>
      )}
      {row.supported && row.detail && (
        <p className="text-[11px] text-muted-foreground pl-0.5">{row.detail}</p>
      )}
    </div>
  );
}

export function ServerCapabilitiesList({
  connection,
}: ServerCapabilitiesListProps) {
  const rows = buildServerCapabilityRows(
    connection.capabilities || {},
    connection.extensions,
    {
      tools: connection.tools,
      resources: connection.resources,
      resourceTemplates: connection.resourceTemplates,
    }
  );

  return (
    <div className="space-y-3" data-testid="server-info-capabilities">
      <Label className="text-sm font-medium">Capabilities</Label>
      <div className="space-y-4 rounded-md border border-border p-3">
        {rows.map((row) => (
          <CapabilityRowView key={row.id} row={row} />
        ))}
      </div>
    </div>
  );
}
