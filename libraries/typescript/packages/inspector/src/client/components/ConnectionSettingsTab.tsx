import { useConnectionFormState } from "@/client/hooks/useConnectionFormState";
import type { EditableConnectionConfig } from "@/client/utils/connectionUpdates";
import type { McpServer } from "@mcp-use/client/react";
import {
  inspectorStickyTabHeaderClass,
  inspectorTabHeaderPadding,
  inspectorTabTitleClass,
} from "@/client/lib/font-weight";
import { inspectorSettingsContentClass } from "@/client/lib/inspector-settings-layout";
import { ConnectionSettingsForm } from "./ConnectionSettingsForm";
import { tabHeaderIconClass } from "./shared/ListTabHeader";
import { Settings } from "lucide-react";
import { Button } from "./ui/button";
import { useState } from "react";

interface ConnectionSettingsTabProps {
  connection: McpServer;
  onSave: (config: EditableConnectionConfig) => void;
}

export function ConnectionSettingsTab({
  connection,
  onSave,
}: ConnectionSettingsTabProps) {
  const form = useConnectionFormState(connection, true);
  const [isScrolled, setIsScrolled] = useState(false);

  const handleSave = () => {
    const config = form.buildConfig();
    if (config) onSave(config);
  };

  return (
    <div
      className="h-full overflow-y-auto overscroll-none"
      onScroll={(event) => setIsScrolled(event.currentTarget.scrollTop > 0)}
    >
      <div
        className={`${inspectorStickyTabHeaderClass(isScrolled)} flex flex-row items-center justify-between gap-2 ${inspectorTabHeaderPadding}`}
      >
        <h2 className={`${inspectorTabTitleClass} flex items-center gap-1.5`}>
          <Settings className={tabHeaderIconClass} aria-hidden />
          Connection Settings
        </h2>
        <Button
          data-testid="connection-form-save-button"
          size="sm"
          onClick={handleSave}
        >
          Save
        </Button>
      </div>

      <div className={inspectorSettingsContentClass}>
        <ConnectionSettingsForm
          alias={form.alias}
          setAlias={form.setAlias}
          url={form.url}
          setUrl={form.setUrl}
          connectionMode={form.connectionMode}
          setConnectionMode={form.setConnectionMode}
          protocolMode={form.protocolMode}
          setProtocolMode={form.setProtocolMode}
          customHeaders={form.customHeaders}
          setCustomHeaders={form.setCustomHeaders}
          requestTimeout={form.requestTimeout}
          setRequestTimeout={form.setRequestTimeout}
          resetTimeoutOnProgress={form.resetTimeoutOnProgress}
          setResetTimeoutOnProgress={form.setResetTimeoutOnProgress}
          maxTotalTimeout={form.maxTotalTimeout}
          setMaxTotalTimeout={form.setMaxTotalTimeout}
          proxyAddress={form.proxyAddress}
          setProxyAddress={form.setProxyAddress}
          clientId={form.clientId}
          setClientId={form.setClientId}
          clientSecret={form.clientSecret}
          setClientSecret={form.setClientSecret}
          scope={form.scope}
          setScope={form.setScope}
          showConnectButton={false}
          showExportButton={false}
          inlineSections
          cardSections
        />
      </div>
    </div>
  );
}
