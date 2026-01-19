import type { McpServer } from "mcp-use/react";

// Type alias for backward compatibility
type MCPConnection = McpServer;
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
  connection: MCPConnection | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnect: (config: {
    url: string;
    name?: string;
    transportType: "http" | "sse";
    proxyConfig?: {
      proxyAddress?: string;
      customHeaders?: Record<string, string>;
    };
  }) => void;
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
  const [url, setUrl] = useState("");
  const [connectionType, setConnectionType] = useState("Direct");
  const [customHeaders, setCustomHeaders] = useState<CustomHeader[]>([]);
  const [requestTimeout, setRequestTimeout] = useState("10000");
  const [resetTimeoutOnProgress, setResetTimeoutOnProgress] = useState("True");
  const [maxTotalTimeout, setMaxTotalTimeout] = useState("60000");
  const [proxyAddress, setProxyAddress] = useState(
    `${window.location.origin}/inspector/api/proxy`
  );
  // OAuth fields
  const [clientId, setClientId] = useState("");
  const [redirectUrl, setRedirectUrl] = useState(
    typeof window !== "undefined"
      ? new URL("/inspector/oauth/callback", window.location.origin).toString()
      : "/inspector/oauth/callback"
  );
  const [scope, setScope] = useState("");

  // Prefill form when connection changes
  useEffect(() => {
    if (connection && open) {
      setUrl(connection.url);

      // Transport type is always HTTP now (SSE is deprecated)
      // No need to set transportType from connection

      // Determine connection type based on proxyConfig
      if (connection.proxyConfig?.proxyAddress) {
        setConnectionType("Via Proxy");
        setProxyAddress(connection.proxyConfig.proxyAddress);
      } else {
        setConnectionType("Direct");
        setProxyAddress(`${window.location.origin}/inspector/api/proxy`);
      }

      // Convert customHeaders from Record<string, string> to CustomHeader[]
      const headersToConvert =
        connection.proxyConfig?.customHeaders || connection.customHeaders || {};
      const headerArray: CustomHeader[] = Object.entries(headersToConvert).map(
        ([name, value], index) => ({
          id: `header-${index}`,
          name,
          value: String(value),
        })
      );
      setCustomHeaders(headerArray);
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

    // Prepare proxy configuration if "Via Proxy" is selected
    const proxyConfig =
      connectionType === "Via Proxy" && proxyAddress.trim()
        ? {
            proxyAddress: proxyAddress.trim(),
            customHeaders: customHeaders.reduce(
              (acc, header) => {
                if (header.name && header.value) {
                  acc[header.name] = header.value;
                }
                return acc;
              },
              {} as Record<string, string>
            ),
          }
        : {
            customHeaders: customHeaders.reduce(
              (acc, header) => {
                if (header.name && header.value) {
                  acc[header.name] = header.value;
                }
                return acc;
              },
              {} as Record<string, string>
            ),
          };

    // Always use HTTP transport (SSE is deprecated)
    const actualTransportType = "http";

    onConnect({
      url: normalizedUrl,
      name: connection?.name,
      transportType: actualTransportType,
      proxyConfig,
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
          transportType="SSE"
          setTransportType={() => {}}
          url={url}
          setUrl={setUrl}
          connectionType={connectionType}
          setConnectionType={setConnectionType}
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
          redirectUrl={redirectUrl}
          setRedirectUrl={setRedirectUrl}
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
