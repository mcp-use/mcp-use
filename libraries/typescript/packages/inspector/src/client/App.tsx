import { RequestActionToast } from "@/client/components/shared/RequestActionToast";
import { DEFAULT_SAMPLING_RESPONSE } from "@/client/types/pending-requests";
import { InspectorDashboard } from "@/client/components/InspectorDashboard";
import { Layout } from "@/client/components/Layout";
import { ManufactOAuthCallback } from "@/client/components/ManufactOAuthCallback";
import { OAuthCallback } from "@/client/components/OAuthCallback";
import { Toaster } from "@/client/components/ui/sonner";
import { ViewPreview } from "@/client/components/ViewPreview";
import { McpClientProvider, type McpServer } from "@mcp-use/client/react";
import { useEffect, useMemo, useRef } from "react";
import { Route, BrowserRouter as Router, Routes } from "react-router";
import { toast } from "sonner";
import { InspectorProvider, useInspector } from "./context/InspectorContext";
import { ThemeProvider } from "./context/ThemeContext";
import { ShapeProvider } from "@/client/lib/shape-context";
import { WidgetDebugProvider } from "./context/WidgetDebugContext";
import { getPackageVersion, initInspectorTelemetry } from "@/client/telemetry";
import { getInspectorBase } from "./utils/basePath";
import {
  getDefaultInspectorProxyAddress,
  InspectorConnectionStorageProvider,
} from "./utils/connectionUpdates";
import { wrapTransportForLegacySampling } from "./utils/samplingProtocol";

/**
 * Syncs the active tab from InspectorContext into a ref readable by
 * McpClientProvider callbacks defined outside the InspectorProvider tree.
 */
function InspectorTabSync({
  activeTabRef,
}: {
  activeTabRef: React.MutableRefObject<string>;
}) {
  const { activeTab } = useInspector();
  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab, activeTabRef]);
  return null;
}

/**
 * Root React component that configures application providers, routing, and toast-based handlers for sampling and elicitation requests in the inspector UI.
 *
 * Creates a LocalStorageProvider for saved connections when not running in embedded mode (determined via the `embedded=true` URL parameter), initializes the MCP client with RPC logging and lifecycle callbacks, and renders the inspector routes (including the OAuth callback and main dashboard) inside theme and inspector contexts. Sampling and elicitation requests are surfaced as persistent toasts that allow viewing details, approving/denying, or opening supplied URLs.
 *
 * @returns The app's React element tree.
 */
function App() {
  const activeTabRef = useRef<string>("tools");

  // Check if embedded mode is active from URL params
  const urlParams = new URLSearchParams(window.location.search);
  const isEmbedded = urlParams.get("embedded") === "true";

  // Check if theme is forced via URL params
  const forcedTheme = urlParams.get("theme") as
    | "light"
    | "dark"
    | "system"
    | null;

  // Create storage provider (only in non-embedded mode)
  const storageProvider = useMemo(
    () =>
      isEmbedded
        ? undefined
        : new InspectorConnectionStorageProvider("mcp-inspector-connections"),
    [isEmbedded]
  );

  // Read the proxy path injected by the inspector server. Missing injection
  // falls back to the standard Inspector route; explicit null disables proxy.
  const proxyAddress = getDefaultInspectorProxyAddress();
  const oauthProxyUrl = proxyAddress?.replace(/\/proxy\/?$/, "/oauth");

  // The inspector's own mount path, `${basePath}/inspector` (default
  // `/mcp/inspector`; root-mount `/inspector`). Derived at runtime from
  // `window.__MCP_BASE_PATH__` so a single prebuilt bundle serves any basePath.
  const inspectorBase = getInspectorBase();
  const isOAuthCallback =
    window.location.pathname.replace(/\/+$/, "") ===
    `${inspectorBase}/oauth/callback`;

  // App-level so it fires regardless of route, and after <Toaster /> mounts.
  useEffect(() => {
    initInspectorTelemetry();
  }, []);

  useEffect(() => {
    const authError = urlParams.get("auth_error");
    if (!authError) return;
    const description = urlParams.get("auth_error_description");
    toast.error(`OAuth authentication failed: ${description || authError}`, {
      duration: Infinity,
      closeButton: true,
    });
    // Clone before mutating so we don't disturb the params consumed above.
    const cleaned = new URLSearchParams(urlParams);
    cleaned.delete("auth_error");
    cleaned.delete("auth_error_description");
    const search = cleaned.toString();
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}${search ? `?${search}` : ""}`
    );
  }, []);

  // Complete the authorization-code exchange before mounting persisted MCP
  // connections. Background reconnects may legitimately refresh their own
  // OAuth state, but the callback leg must have exclusive access to the
  // verifier and discovery record created for this authorization request.
  if (isOAuthCallback) {
    return (
      <ThemeProvider forcedTheme={forcedTheme || undefined}>
        <ShapeProvider defaultShape="pill">
          <OAuthCallback />
          <Toaster position="top-center" />
        </ShapeProvider>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider forcedTheme={forcedTheme || undefined}>
      <ShapeProvider defaultShape="pill">
        <WidgetDebugProvider>
          <McpClientProvider
            storageProvider={storageProvider}
            enableRpcLogging={true}
            defaultCallbackUrl={`${window.location.origin}${inspectorBase}/oauth/callback`}
            defaultOAuthProxyUrl={oauthProxyUrl}
            defaultAutoProxyFallback={
              proxyAddress ? { enabled: true, proxyAddress } : false
            }
            defaultServerConfig={{
              preventAutoAuth: true,
              useRedirectFlow: true,
              wrapTransport: wrapTransportForLegacySampling,
            }}
            clientInfo={{
              name: "mcp-use Inspector",
              version: getPackageVersion(),
              websiteUrl: "https://mcp-use.com",
              icons: [{ src: "https://mcp-use.com/logo.png" }],
              capabilities: {
                extensions: {
                  "io.modelcontextprotocol/ui": {
                    mimeTypes: ["text/html;profile=mcp-app"],
                  },
                },
              },
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
            onSamplingRequest={(
              request,
              _serverId,
              serverName,
              approve,
              reject
            ) => {
              const toastId = toast(
                <RequestActionToast
                  title="Sampling Request Received"
                  description={`New request from ${serverName}`}
                  actions={[
                    {
                      label: "View Details",
                      testId: "sampling-toast-view-details",
                      onClick: () => {
                        const event = new CustomEvent("navigate-to-sampling", {
                          detail: { requestId: request.id },
                        });
                        window.dispatchEvent(event);
                        toast.dismiss(toastId);
                      },
                    },
                    {
                      label: "Approve",
                      testId: "sampling-toast-approve",
                      onClick: () => {
                        approve(request.id, DEFAULT_SAMPLING_RESPONSE);
                        toast.success("Sampling request approved");
                        toast.dismiss(toastId);
                      },
                    },
                    {
                      label: "Deny",
                      testId: "sampling-toast-deny",
                      onClick: () => {
                        reject(request.id, "User denied from toast");
                        toast.dismiss(toastId);
                      },
                    },
                  ]}
                />,
                { duration: Infinity }
              );
            }}
            onElicitationRequest={(
              request,
              _serverId,
              serverName,
              _approve,
              reject
            ) => {
              // When the chat tab is active, elicitation is rendered inline — no toast needed.
              if (activeTabRef.current === "chat") {
                return;
              }

              const mode = request.request.mode || "form";
              const message = request.request.message;
              const url =
                mode === "url" && "url" in request.request
                  ? request.request.url
                  : undefined;

              const toastId = toast(
                <RequestActionToast
                  title="Elicitation Request Received"
                  description={`From ${serverName}: ${message}`}
                  extra={
                    mode === "url" && url ? (
                      <p className="text-xs text-muted-foreground mt-1 font-mono">
                        {url}
                      </p>
                    ) : undefined
                  }
                  actions={[
                    {
                      label: "View Details",
                      testId: "elicitation-toast-view-details",
                      onClick: () => {
                        const event = new CustomEvent(
                          "navigate-to-elicitation",
                          {
                            detail: { requestId: request.id },
                          }
                        );
                        window.dispatchEvent(event);
                        toast.dismiss(toastId);
                      },
                    },
                    ...(mode === "url" && url
                      ? [
                          {
                            label: "Open URL",
                            testId: "elicitation-toast-open-url",
                            onClick: () => {
                              window.open(url, "_blank");
                              toast.dismiss(toastId);
                            },
                          },
                        ]
                      : []),
                    {
                      label: "Cancel",
                      testId: "elicitation-toast-cancel",
                      onClick: () => {
                        reject(request.id, "User cancelled from toast");
                        toast.dismiss(toastId);
                      },
                    },
                  ]}
                />,
                { duration: Infinity }
              );
            }}
          >
            <InspectorProvider>
              <InspectorTabSync activeTabRef={activeTabRef} />
              <Router basename={inspectorBase}>
                <Routes>
                  <Route path="/oauth/callback" element={<OAuthCallback />} />
                  <Route
                    path="/auth/callback"
                    element={<ManufactOAuthCallback />}
                  />
                  <Route path="/preview/:view" element={<ViewPreview />} />
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
        </WidgetDebugProvider>
      </ShapeProvider>
    </ThemeProvider>
  );
}

export default App;
