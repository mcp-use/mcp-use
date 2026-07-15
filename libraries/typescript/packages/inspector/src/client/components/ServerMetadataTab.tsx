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
import { tabHeaderIconClass } from "./shared/ListTabHeader";
import { inspectorTabTitleClass, inspectorTabHeaderPadding, inspectorStickyTabHeaderClass } from "@/client/lib/font-weight";
import {
  inspectorSettingsContentClass,
} from "@/client/lib/inspector-settings-layout";
import { ServerMetadataPanel } from "./ServerMetadataPanel";
import { Info } from "lucide-react";

const METADATA_TABS_ID = "server-metadata";

interface ServerMetadataTabProps {
  connection: McpServer;
}

export function ServerMetadataTab({ connection }: ServerMetadataTabProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isScrolled, setIsScrolled] = useState(false);
  const rawPayload = buildInitializeResultPayload(connection);

  return (
    <div
      className="h-full overflow-y-auto overscroll-none"
      onScroll={(event) => setIsScrolled(event.currentTarget.scrollTop > 0)}
    >
      <div
        className={`${inspectorStickyTabHeaderClass(isScrolled)} flex flex-row items-center justify-between gap-2 ${inspectorTabHeaderPadding}`}
      >
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
          <h2
            className={`${inspectorTabTitleClass} flex items-center gap-1.5`}
            data-testid="server-info-modal-title"
          >
            <Info className={tabHeaderIconClass} aria-hidden />
            Server Metadata
          </h2>
          <TabsSubtle
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
            idPrefix={METADATA_TABS_ID}
            className="shrink-0"
          >
            <TabsSubtleItem label="Formatted" index={0} />
            <TabsSubtleItem label="Raw" index={1} />
          </TabsSubtle>
        </div>
      </div>

      <TabsSubtlePanel
        index={0}
        selectedIndex={selectedIndex}
        idPrefix={METADATA_TABS_ID}
        className={inspectorSettingsContentClass}
      >
        <ServerMetadataPanel connection={connection} />
      </TabsSubtlePanel>
      <TabsSubtlePanel
        index={1}
        selectedIndex={selectedIndex}
        idPrefix={METADATA_TABS_ID}
        className="px-4 pt-6 pb-6"
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
  );
}
