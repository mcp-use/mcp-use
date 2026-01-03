import { InspectorDashboard } from "@/client/components/InspectorDashboard";
import { Layout } from "@/client/components/Layout";
import { OAuthCallback } from "@/client/components/OAuthCallback";
import { Toaster } from "@/client/components/ui/sonner";
import {
  LocalStorageProvider,
  McpClientProvider,
  type McpServer,
} from "mcp-use/react";
import { useMemo } from "react";
import { Route, BrowserRouter as Router, Routes } from "react-router";
import { InspectorProvider } from "./context/InspectorContext";
import { ThemeProvider } from "./context/ThemeContext";

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
        onServerAdded={(id: string, server: McpServer) => {
          console.log("[Inspector] Server added:", id, server.state);
        }}
        onServerRemoved={(id: string) => {
          console.log("[Inspector] Server removed:", id);
        }}
        onServerStateChange={(id: string, state: McpServer["state"]) => {
          console.log("[Inspector] Server state changed:", id, state);
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
