import type { MCPConnection } from "@/client/context/McpContext";
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

export function ServerConnectionModal({
  connection,
  open,
  onOpenChange,
  onConnect,
}: ServerConnectionModalProps) {
  // Form state
  const [transportType, setTransportType] = useState("SSE");
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

      // Map transportType: "http" -> "SSE", "sse" -> "WebSocket"
      if (connection.transportType === "sse") {
        setTransportType("WebSocket");
      } else {
        setTransportType("SSE");
      }

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

    // Validate URL format before attempting connection
    try {
      const parsedUrl = new URL(url.trim());
      const isValid =
        parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";

      if (!isValid) {
        toast.error("Invalid URL protocol. Please use http:// or https://");
        return;
      }
    } catch (error) {
      toast.error("Invalid URL format. Please enter a valid URL.");
      return;
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

    // Map UI transport type to actual transport type
    // "SSE" in UI means "Streamable HTTP" which uses 'http' transport
    const actualTransportType = transportType === "SSE" ? "http" : "sse";

    onConnect({
      url,
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
          transportType={transportType}
          setTransportType={setTransportType}
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
