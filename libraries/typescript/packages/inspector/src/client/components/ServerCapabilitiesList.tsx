import { getServerDisplayName } from "@/client/utils/servers";
import type { McpServer } from "@mcp-use/client/react";
import { JSONDisplay } from "./shared/JSONDisplay";

interface ServerCapabilitiesListProps {
  connection: McpServer;
}

export function ServerCapabilitiesList({
  connection,
}: ServerCapabilitiesListProps) {
  const capabilities = connection.capabilities;
  const hasCapabilities =
    capabilities && Object.keys(capabilities).length > 0;

  if (!hasCapabilities) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="server-info-capabilities">
        No capabilities reported.
      </p>
    );
  }

  return (
    <div
      className="overflow-x-auto"
      data-testid="server-info-capabilities-json"
    >
      <JSONDisplay
        data={capabilities}
        filename={`capabilities-${getServerDisplayName(connection)}.json`}
      />
    </div>
  );
}
