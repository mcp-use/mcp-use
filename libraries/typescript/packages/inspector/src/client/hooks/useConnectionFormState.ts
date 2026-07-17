import type { CustomHeader } from "@/client/components/CustomHeadersEditor";
import {
  buildOAuthStaticConfig,
  getDefaultInspectorProxyAddress,
  getStoredConnectionConfig,
  protocolModeFromNegotiation,
  protocolNegotiationForMode,
  toEditableConnectionConfig,
  type ConnectionMode,
  type EditableConnectionConfig,
  type InspectorProtocolMode,
} from "@/client/utils/connectionUpdates";
import type { McpServer } from "@mcp-use/client/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export function useConnectionFormState(
  connection: McpServer | null,
  enabled: boolean
) {
  const [alias, setAlias] = useState("");
  const [url, setUrl] = useState("");
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>("auto");
  const [protocolMode, setProtocolMode] =
    useState<InspectorProtocolMode>("auto");
  const [customHeaders, setCustomHeaders] = useState<CustomHeader[]>([]);
  const [requestTimeout, setRequestTimeout] = useState("10000");
  const [resetTimeoutOnProgress, setResetTimeoutOnProgress] = useState("True");
  const [maxTotalTimeout, setMaxTotalTimeout] = useState("60000");
  const [proxyAddress, setProxyAddress] = useState(
    getDefaultInspectorProxyAddress()
  );
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [scope, setScope] = useState("");

  useEffect(() => {
    if (!connection || !enabled) return;

    const storedConfig = getStoredConnectionConfig<EditableConnectionConfig>(
      connection.id
    );
    const editable = toEditableConnectionConfig(connection, storedConfig);

    setUrl(editable.url);
    setAlias(editable.name || editable.url);

    const resolvedProxyAddress =
      editable.proxyConfig?.proxyAddress ||
      (typeof editable.autoProxyFallback === "object"
        ? editable.autoProxyFallback.proxyAddress
        : undefined);
    setConnectionMode(editable.connectionMode || "auto");
    setProtocolMode(protocolModeFromNegotiation(editable.protocolNegotiation));
    setProxyAddress(resolvedProxyAddress || getDefaultInspectorProxyAddress());

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
  }, [connection, enabled]);

  const buildConfig = (): EditableConnectionConfig | null => {
    if (!url.trim()) return null;

    let normalizedUrl = url.trim();
    try {
      const parsedUrl = new URL(normalizedUrl);
      const isValid =
        parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";

      if (!isValid) {
        toast.error("Invalid URL protocol. Please use http:// or https://");
        return null;
      }
    } catch {
      try {
        const urlWithHttps = `https://${normalizedUrl}`;
        const parsedUrl = new URL(urlWithHttps);
        const isValid =
          parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";

        if (!isValid) {
          toast.error("Invalid URL protocol. Please use http:// or https://");
          return null;
        }
        normalizedUrl = urlWithHttps;
      } catch {
        toast.error("Invalid URL format. Please enter a valid URL.");
        return null;
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

    return {
      url: normalizedUrl,
      name: alias.trim() || normalizedUrl,
      transportType: "http",
      connectionMode,
      protocolNegotiation: protocolNegotiationForMode(protocolMode),
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
    };
  };

  return {
    alias,
    setAlias,
    url,
    setUrl,
    connectionMode,
    setConnectionMode,
    protocolMode,
    setProtocolMode,
    customHeaders,
    setCustomHeaders,
    requestTimeout,
    setRequestTimeout,
    resetTimeoutOnProgress,
    setResetTimeoutOnProgress,
    maxTotalTimeout,
    setMaxTotalTimeout,
    proxyAddress,
    setProxyAddress,
    clientId,
    setClientId,
    clientSecret,
    setClientSecret,
    scope,
    setScope,
    buildConfig,
  };
}
