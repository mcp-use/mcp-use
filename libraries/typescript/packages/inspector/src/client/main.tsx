import { onMcpAuthorization } from "mcp-use/react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Handle OAuth callback if this is a redirect from an OAuth provider
// Only run if we have callback parameters
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has("code") || urlParams.has("error")) {
  try {
    onMcpAuthorization();
  } catch (error) {
    console.error("[inspector] OAuth callback error:", error);
  }
}

// Wait for DOM to be ready before rendering
const rootElement = document.getElementById("root");
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(<App />);
} else {
  console.error("[inspector] Root element not found");
}
