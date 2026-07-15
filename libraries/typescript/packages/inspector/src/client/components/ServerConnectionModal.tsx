import type { McpServer } from "@mcp-use/client/react";
import {
  buildOAuthStaticConfig,
  getDefaultInspectorProxyAddress,
  getStoredConnectionConfig,
  toEditableConnectionConfig,
  type ConnectionMode,
  type EditableConnectionConfig,
} from "@/client/utils/connectionUpdates";

import type { CustomHeader } from "./CustomHeadersEditor";
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { ConnectionSettingsForm } from "./ConnectionSettingsForm";
import { toast } from "sonner";

interface ServerConnectionModalProps {
  connection: McpServer | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnect: (config: EditableConnectionConfig) => void;
}

/**
 * Renders a modal for viewing and editing a server connection's settings.
 *
 * @param connection - Existing connection to prefill the form, or `null` to start empty
 * @param open - Whether the modal is visible
 * @param onOpenChange - Callback invoked with the new open state when the modal is opened or closed
 * @param onConnect - Callback invoked with the connection configuration when the user submits the form
 * @returns The modal's JSX element
 */
export function ServerConnectionModal({
  connection,
  open,
  onOpenChange,
  onConnect,
}: ServerConnectionModalProps) {
  // Form state
  const [alias, setAlias] = useState("");
  const [url, setUrl] = useState("");
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>("auto");
  const [customHeaders, setCustomHeaders] = useState<CustomHeader[]>([]);
  const [requestTimeout, setRequestTimeout] = useState("10000");
  const [resetTimeoutOnProgress, setResetTimeoutOnProgress] = useState("True");
  const [maxTotalTimeout, setMaxTotalTimeout] = useState("60000");
  const [proxyAddress, setProxyAddress] = useState(
    getDefaultInspectorProxyAddress()
  );
  // OAuth fields
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [scope, setScope] = useState("");

  // Prefill form when connection changes
  useEffect(() => {
    if (connection && open) {
      const storedConfig = getStoredConnectionConfig<EditableConnectionConfig>(
        connection.id
      );
      const editable = toEditableConnectionConfig(connection, storedConfig);

      setUrl(editable.url);
      setAlias(editable.name || editable.url);

      const proxyAddress =
        editable.proxyConfig?.proxyAddress ||
        (typeof editable.autoProxyFallback === "object"
          ? editable.autoProxyFallback.proxyAddress
          : undefined);
      setConnectionMode(editable.connectionMode || "auto");
      setProxyAddress(
        proxyAddress || getDefaultInspectorProxyAddress()
      );

      const headersToConvert = editable.headers || {};
      const headerArray: CustomHeader[] = Object.entries(headersToConvert).map(
        ([name, value], index) => ({
          id: `header-${index}`,
          name,
          value: String(value),
        })
      );
      setCustomHeaders(headerArray);

      setClientId(editable.oauth?.clientId || "");
      setClientSecret(editable.oauth?.clientSecret || "");
      setScope(editable.oauth?.scope || "");

      if (editable.requestTimeout !== undefined) {
        setRequestTimeout(String(editable.requestTimeout));
      }
      if (editable.resetTimeoutOnProgress !== undefined) {
        setResetTimeoutOnProgress(
          editable.resetTimeoutOnProgress ? "True" : "False"
        );
      }
      if (editable.maxTotalTimeout !== undefined) {
        setMaxTotalTimeout(String(editable.maxTotalTimeout));
      }
    }
  }, [connection, open]);

  const handleConnect = () => {
    if (!url.trim()) return;

    // Validate URL format and auto-add https:// if protocol is missing
    let normalizedUrl = url.trim();
    try {
      const parsedUrl = new URL(normalizedUrl);
      const isValid =
        parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";

      if (!isValid) {
        toast.error("Invalid URL protocol. Please use http:// or https://");
        return;
      }
    } catch (error) {
      // If parsing fails, try adding https:// prefix
      try {
        const urlWithHttps = `https://${normalizedUrl}`;
        const parsedUrl = new URL(urlWithHttps);
        const isValid =
          parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";

        if (!isValid) {
          toast.error("Invalid URL protocol. Please use http:// or https://");
          return;
        }
        // Use the normalized URL with https://
        normalizedUrl = urlWithHttps;
      } catch (retryError) {
        toast.error("Invalid URL format. Please enter a valid URL.");
        return;
      }
    }

    const headers = customHeaders.reduce(
      (acc, header) => {
        if (header.name && header.value) {
          acc[header.name] = header.value;
        }
        return acc;
      },
      {} as Record<string, string>
    );

    const proxyConfig =
      connectionMode === "proxy" && proxyAddress.trim()
        ? {
            proxyAddress: proxyAddress.trim(),
            headers,
          }
        : undefined;

    const autoProxyFallback =
      connectionMode === "auto"
        ? proxyAddress.trim()
          ? { enabled: true, proxyAddress: proxyAddress.trim() }
          : false
        : false;

    const oauth = buildOAuthStaticConfig(clientId, clientSecret, scope);
    const parsedRequestTimeout = Number.parseInt(requestTimeout, 10);
    const parsedMaxTotalTimeout = Number.parseInt(maxTotalTimeout, 10);

    onConnect({
      url: normalizedUrl,
      name: alias.trim() || normalizedUrl,
      transportType: "http",
      connectionMode,
      proxyConfig,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      autoProxyFallback,
      ...(oauth ? { oauth } : {}),
      ...(Number.isFinite(parsedRequestTimeout)
        ? { requestTimeout: parsedRequestTimeout }
        : {}),
      resetTimeoutOnProgress: resetTimeoutOnProgress === "True",
      ...(Number.isFinite(parsedMaxTotalTimeout)
        ? { maxTotalTimeout: parsedMaxTotalTimeout }
        : {}),
    });

    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Connection Settings</DialogTitle>
        </DialogHeader>
        <ConnectionSettingsForm
          alias={alias}
          setAlias={setAlias}
          url={url}
          setUrl={setUrl}
          connectionMode={connectionMode}
          setConnectionMode={setConnectionMode}
          customHeaders={customHeaders}
          setCustomHeaders={setCustomHeaders}
          requestTimeout={requestTimeout}
          setRequestTimeout={setRequestTimeout}
          resetTimeoutOnProgress={resetTimeoutOnProgress}
          setResetTimeoutOnProgress={setResetTimeoutOnProgress}
          maxTotalTimeout={maxTotalTimeout}
          setMaxTotalTimeout={setMaxTotalTimeout}
          proxyAddress={proxyAddress}
          setProxyAddress={setProxyAddress}
          clientId={clientId}
          setClientId={setClientId}
          clientSecret={clientSecret}
          setClientSecret={setClientSecret}
          scope={scope}
          setScope={setScope}
          onConnect={handleConnect}
          variant="default"
          showConnectButton={true}
          showExportButton={false}
          isConnecting={false}
        />
      </DialogContent>
    </Dialog>
  );
}
