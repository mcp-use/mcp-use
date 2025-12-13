import { Route, BrowserRouter as Router, Routes } from "react-router";
import { InspectorDashboard } from "@/client/components/InspectorDashboard";
import { Layout } from "@/client/components/Layout";
import { OAuthCallback } from "@/client/components/OAuthCallback";
import { Toaster } from "@/client/components/ui/sonner";
import { InspectorProvider } from "./context/InspectorContext";
import { McpProvider } from "./context/McpContext";
import { ThemeProvider } from "./context/ThemeContext";

function App() {
  return (
    <ThemeProvider>
      <McpProvider>
        <InspectorProvider>
          <Router basename="/inspector">
            <Routes>
              {/* OAuth callback route - no layout needed */}
              <Route path="/oauth/callback" element={<OAuthCallback />} />
              {/* Main app route with layout */}
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
    </ThemeProvider>
  );
}

export default App;
