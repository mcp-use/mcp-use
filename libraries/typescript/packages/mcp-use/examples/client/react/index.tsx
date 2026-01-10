import React from "react";
import ReactDOM from "react-dom/client";
import ReactExample from "./react_example";
import MultiServerExample from "./multi-server-example";
import OAuthCallback from "./oauth-callback";

// Navigation component
function Navigation() {
  const currentPath = window.location.pathname;

  return (
    <div
      style={{
        padding: "10px 20px",
        backgroundColor: "#333",
        color: "white",
        marginBottom: "20px",
      }}
    >
      <nav style={{ display: "flex", gap: "20px", alignItems: "center" }}>
        <span style={{ fontWeight: "bold" }}>MCP Examples:</span>
        <a
          href="/"
          style={{
            color: currentPath === "/" ? "#4CAF50" : "#fff",
            textDecoration: "none",
            fontWeight: currentPath === "/" ? "bold" : "normal",
          }}
        >
          Single Server
        </a>
        <a
          href="/multi-server"
          style={{
            color: currentPath === "/multi-server" ? "#4CAF50" : "#fff",
            textDecoration: "none",
            fontWeight: currentPath === "/multi-server" ? "bold" : "normal",
          }}
        >
          Multi-Server
        </a>
      </nav>
    </div>
  );
}

// Simple router based on pathname
function App() {
  const path = window.location.pathname;

  // Route to OAuth callback page (no navigation)
  if (path === "/oauth/callback") {
    return <OAuthCallback />;
  }

  // All other routes show navigation
  return (
    <div>
      <Navigation />
      {path === "/multi-server" ? <MultiServerExample /> : <ReactExample />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
