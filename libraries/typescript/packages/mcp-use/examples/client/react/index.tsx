import React from "react";
import ReactDOM from "react-dom/client";
import ReactExample from "./react_example";
import OAuthCallback from "./oauth-callback";

// Simple router based on pathname
function App() {
  const path = window.location.pathname;

  // Route to OAuth callback page
  if (path === "/oauth/callback") {
    return <OAuthCallback />;
  }

  // Default to main example
  return <ReactExample />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
