import { useConnectionFormState } from "@/client/hooks/useConnectionFormState";
import type { EditableConnectionConfig } from "@/client/utils/connectionUpdates";
import type { McpServer } from "@mcp-use/client/react";
import { inspectorTabHeaderPadding, inspectorTabTitleClass } from "@/client/lib/font-weight";
import { ConnectionSettingsForm } from "./ConnectionSettingsForm";

interface ConnectionSettingsTabProps {
  connection: McpServer;
  onSave: (config: EditableConnectionConfig) => void;
}

export function ConnectionSettingsTab({
  connection,
  onSave,
}: ConnectionSettingsTabProps) {
  const form = useConnectionFormState(connection, true);

  const handleSave = () => {
    const config = form.buildConfig();
    if (config) onSave(config);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className={`${inspectorTabHeaderPadding} sm:pb-6 max-w-2xl`}>
        <h2 className={`${inspectorTabTitleClass} mb-6`}>
          Connection Settings
        </h2>
        <ConnectionSettingsForm
          alias={form.alias}
          setAlias={form.setAlias}
          url={form.url}
          setUrl={form.setUrl}
          connectionMode={form.connectionMode}
          setConnectionMode={form.setConnectionMode}
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
          onSave={handleSave}
          showSaveButton
          showConnectButton={false}
          showExportButton={false}
        />
      </div>
    </div>
  );
}
