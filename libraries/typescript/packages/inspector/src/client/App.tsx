import { ElicitationRequestToast } from "@/client/components/elicitation/ElicitationRequestToast";
import { InspectorDashboard } from "@/client/components/InspectorDashboard";
import { Layout } from "@/client/components/Layout";
import { OAuthCallback } from "@/client/components/OAuthCallback";
import { SamplingRequestToast } from "@/client/components/sampling/SamplingRequestToast";
import { Toaster } from "@/client/components/ui/sonner";
import {
  LocalStorageProvider,
  McpClientProvider,
  type McpServer,
} from "mcp-use/react";
import { useMemo } from "react";
import { Route, BrowserRouter as Router, Routes } from "react-router";
import { toast } from "sonner";
import { InspectorProvider } from "./context/InspectorContext";
import { ThemeProvider } from "./context/ThemeContext";

/**
 * Root React component that configures application providers, routing, and toast-based handlers for sampling and elicitation requests in the inspector UI.
 *
 * Creates a LocalStorageProvider for saved connections when not running in embedded mode (determined via the `embedded=true` URL parameter), initializes the MCP client with RPC logging and lifecycle callbacks, and renders the inspector routes (including the OAuth callback and main dashboard) inside theme and inspector contexts. Sampling and elicitation requests are surfaced as persistent toasts that allow viewing details, approving/denying, or opening supplied URLs.
 *
 * @returns The app's React element tree.
 */
function App() {
  // Check if embedded mode is active from URL params
  const urlParams = new URLSearchParams(window.location.search);
  const isEmbedded = urlParams.get("embedded") === "true";

  // Create storage provider (only in non-embedded mode)
  const storageProvider = useMemo(
    () =>
      isEmbedded
        ? undefined
        : new LocalStorageProvider("mcp-inspector-connections"),
    [isEmbedded]
  );

  return (
    <ThemeProvider>
      <McpClientProvider
        storageProvider={storageProvider}
        enableRpcLogging={true}
        defaultAutoProxyFallback={{
          enabled: true,
          proxyAddress: `${window.location.origin}/inspector/api/proxy`,
        }}
        onServerAdded={(id: string, server: McpServer) => {
          console.log("[Inspector] Server added:", id, server.state);
        }}
        onServerRemoved={(id: string) => {
          console.log("[Inspector] Server removed:", id);
        }}
        onServerStateChange={(id: string, state: McpServer["state"]) => {
          console.log("[Inspector] Server state changed:", id, state);
        }}
        onSamplingRequest={(request, serverId, serverName, approve, reject) => {
          const toastId = toast(
            <SamplingRequestToast
              requestId={request.id}
              serverName={serverName}
              onViewDetails={() => {
                const event = new CustomEvent("navigate-to-sampling", {
                  detail: { requestId: request.id },
                });
                window.dispatchEvent(event);
                toast.dismiss(toastId);
              }}
              onApprove={(defaultResponse) => {
                approve(request.id, defaultResponse);
                toast.success("Sampling request approved");
                toast.dismiss(toastId);
              }}
              onDeny={() => {
                reject(request.id, "User denied from toast");
                toast.dismiss(toastId);
              }}
            />,
            { duration: Infinity }
          );
        }}
        onElicitationRequest={(
          request,
          serverId,
          serverName,
          approve,
          reject
        ) => {
          const mode = request.request.mode || "form";
          const message = request.request.message;
          const url =
            mode === "url" && "url" in request.request
              ? request.request.url
              : undefined;

          const toastId = toast(
            <ElicitationRequestToast
              requestId={request.id}
              serverName={serverName}
              mode={mode}
              message={message}
              url={url}
              onViewDetails={() => {
                const event = new CustomEvent("navigate-to-elicitation", {
                  detail: { requestId: request.id },
                });
                window.dispatchEvent(event);
                toast.dismiss(toastId);
              }}
              onOpenUrl={
                mode === "url" && url
                  ? () => {
                      window.open(url, "_blank");
                      toast.dismiss(toastId);
                    }
                  : undefined
              }
              onCancel={() => {
                reject(request.id, "User cancelled from toast");
                toast.dismiss(toastId);
              }}
            />,
            { duration: Infinity }
          );
        }}
      >
        <InspectorProvider>
          <Router basename="/inspector">
            <Routes>
              <Route path="/oauth/callback" element={<OAuthCallback />} />
              <Route
                path="/"
                element={
                  <Layout>
                    <InspectorDashboard />
                  </Layout>
                }
              />
            </Routes>
          </Router>
          <Toaster position="top-center" />
        </InspectorProvider>
      </McpClientProvider>
    </ThemeProvider>
  );
}

export default App;
