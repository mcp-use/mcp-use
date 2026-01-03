import { InspectorDashboard } from "@/client/components/InspectorDashboard";
import { Layout } from "@/client/components/Layout";
import { OAuthCallback } from "@/client/components/OAuthCallback";
import { Toaster } from "@/client/components/ui/sonner";
import { McpClientProvider } from "mcp-use/react";
import { Route, BrowserRouter as Router, Routes } from "react-router";
import { InspectorProvider } from "./context/InspectorContext";
import { McpProvider } from "./context/McpContext";
import { ThemeProvider } from "./context/ThemeContext";

function App() {
  // Check if embedded mode is active from URL params
  const urlParams = new URLSearchParams(window.location.search);
  const isEmbedded = urlParams.get("embedded") === "true";

  return (
    <ThemeProvider>
      <McpClientProvider>
        <McpProvider embedded={isEmbedded}>
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
        </McpProvider>
      </McpClientProvider>
    </ThemeProvider>
  );
}

export default App;
