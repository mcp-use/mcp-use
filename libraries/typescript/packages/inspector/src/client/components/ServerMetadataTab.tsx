import { buildInitializeResultPayload } from "@/client/utils/serverMetadata";
import { getServerDisplayName } from "@/client/utils/servers";
import type { McpServer } from "@mcp-use/client/react";
import { useState } from "react";
import {
  TabsSubtle,
  TabsSubtleItem,
  TabsSubtlePanel,
} from "@/client/components/ui/tabs-subtle";
import { JSONDisplay } from "./shared/JSONDisplay";
import { inspectorTabHeaderPadding, inspectorTabTitleClass } from "@/client/lib/font-weight";
import { ServerMetadataPanel } from "./ServerMetadataPanel";

const METADATA_TABS_ID = "server-metadata";

interface ServerMetadataTabProps {
  connection: McpServer;
}

export function ServerMetadataTab({ connection }: ServerMetadataTabProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const rawPayload = buildInitializeResultPayload(connection);

  return (
    <div className="h-full overflow-y-auto">
      <div className={`${inspectorTabHeaderPadding} sm:pb-6`}>
        <h2
          className={inspectorTabTitleClass}
          data-testid="server-info-modal-title"
        >
          Server Metadata
        </h2>

        <TabsSubtle
          selectedIndex={selectedIndex}
          onSelect={setSelectedIndex}
          idPrefix={METADATA_TABS_ID}
          className="mt-4"
        >
          <TabsSubtleItem label="Formatted" index={0} />
          <TabsSubtleItem label="Raw" index={1} />
        </TabsSubtle>

        <div className="mt-6">
          <TabsSubtlePanel
            index={0}
            selectedIndex={selectedIndex}
            idPrefix={METADATA_TABS_ID}
          >
            <ServerMetadataPanel connection={connection} />
          </TabsSubtlePanel>
          <TabsSubtlePanel
            index={1}
            selectedIndex={selectedIndex}
            idPrefix={METADATA_TABS_ID}
          >
            <div data-testid="server-info-raw">
              {Object.keys(rawPayload).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No initialize metadata yet. Connect to the server first.
                </p>
              ) : (
                <JSONDisplay
                  data={rawPayload}
                  filename={`initialize-result-${getServerDisplayName(connection)}-${Date.now()}.json`}
                />
              )}
            </div>
          </TabsSubtlePanel>
        </div>
      </div>
    </div>
  );
}
