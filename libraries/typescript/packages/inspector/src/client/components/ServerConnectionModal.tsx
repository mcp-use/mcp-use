import type { McpServer } from "@mcp-use/client/react";
import type { EditableConnectionConfig } from "@/client/utils/connectionUpdates";
import { useConnectionFormState } from "@/client/hooks/useConnectionFormState";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { ConnectionSettingsForm } from "./ConnectionSettingsForm";

interface ServerConnectionModalProps {
  connection: McpServer | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnect: (config: EditableConnectionConfig) => void;
}

export function ServerConnectionModal({
  connection,
  open,
  onOpenChange,
  onConnect,
}: ServerConnectionModalProps) {
  const form = useConnectionFormState(connection, open);

  const handleConnect = () => {
    const config = form.buildConfig();
    if (!config) return;
    onConnect(config);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        scrollable
        className="w-[calc(100vw-2rem)] sm:w-full max-w-2xl max-h-[90vh]"
      >
        <DialogHeader>
          <DialogTitle>Edit Connection Settings</DialogTitle>
        </DialogHeader>
        <DialogBody>
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
          onConnect={handleConnect}
          variant="default"
          showConnectButton
          showExportButton={false}
          isConnecting={false}
        />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
