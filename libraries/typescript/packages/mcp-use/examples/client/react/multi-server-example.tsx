import { McpClientProvider, useMcpClient } from "mcp-use/react";
import React, { useEffect } from "react";

/**
 * Example component that uses the new multi-server McpClientProvider
 * Demonstrates how to manage multiple MCP servers in a single application
 */

// Component that manages multiple servers
const ServerManager: React.FC = () => {
  const { addServer, removeServer, servers } = useMcpClient();

  useEffect(() => {
    // Add multiple servers on mount
    addServer("linear", {
      url: "https://mcp.linear.app/mcp",
      name: "Linear (OAuth)",
      timeout: 30000,
      preventAutoAuth: true,
    });

    addServer("vercel", {
      url: "https://mcp.vercel.com",
      name: "Vercel (OAuth)",
      timeout: 30000,
      preventAutoAuth: false, // Allow OAuth flow to proceed
    });

    addServer("no api key needed", {
      url: "https://apps-sdk-starter.mcp-use.run",
      name: "No API Key (MCP Use)",
    });
  }, [addServer]);

  return (
    <div style={{ padding: "20px", fontFamily: "Arial, sans-serif" }}>
      <h1>Multi-Server MCP Manager</h1>

      <p>
        This example demonstrates the new <code>McpClientProvider</code> that
        allows you to manage multiple MCP server connections in a single React
        application without re-initializing the protocol for each server.
      </p>
      <h4>Features:</h4>
      <ul>
        <li>✅ Manage multiple servers dynamically</li>
        <li>✅ Add/remove servers at runtime</li>
        <li>✅ Notification management per server</li>
        <li>✅ Sampling/elicitation request handling</li>
        <li>✅ Access servers via hooks: useMcpClient(), useMcpServer(id)</li>
        <li>✅ Backward compatible with standalone useMcp()</li>
      </ul>

      <div style={{ marginBottom: "20px" }}>
        <h2>Connected Servers ({servers.length})</h2>
        {servers.length === 0 ? (
          <p style={{ color: "#6c757d" }}>No servers connected yet...</p>
        ) : (
          <div
            style={{ display: "flex", flexDirection: "column", gap: "10px" }}
          >
            {servers.map((server) => (
              <div
                key={server.id}
                style={{
                  border: "1px solid #dee2e6",
                  borderRadius: "4px",
                  padding: "15px",
                  backgroundColor: "#f8f9fa",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <h3 style={{ margin: "0 0 5px 0" }}>
                      {server.serverInfo?.name || server.id}
                    </h3>
                    <div
                      style={{
                        fontSize: "0.9em",
                        color: "#6c757d",
                      }}
                    >
                      State:{" "}
                      <span
                        style={{
                          color:
                            server.state === "ready"
                              ? "#28a745"
                              : server.state === "failed"
                                ? "#dc3545"
                                : "#ffc107",
                          fontWeight: "bold",
                        }}
                      >
                        {server.state}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => removeServer(server.id)}
                    style={{
                      padding: "6px 12px",
                      backgroundColor: "#dc3545",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                    }}
                  >
                    Remove
                  </button>
                </div>

                {server.state === "ready" && (
                  <div style={{ marginTop: "10px" }}>
                    <div style={{ fontSize: "0.9em" }}>
                      📦 Tools: {server.tools.length} | 📄 Resources:{" "}
                      {server.resources.length} | 💬 Prompts:{" "}
                      {server.prompts.length}
                    </div>
                    {server.unreadNotificationCount > 0 && (
                      <div style={{ fontSize: "0.9em", color: "#ffc107" }}>
                        🔔 {server.unreadNotificationCount} unread notifications
                      </div>
                    )}
                    {server.pendingSamplingRequests.length > 0 && (
                      <div style={{ fontSize: "0.9em", color: "#17a2b8" }}>
                        🤖 {server.pendingSamplingRequests.length} pending
                        sampling requests
                      </div>
                    )}
                  </div>
                )}

                {server.error && (
                  <div
                    style={{
                      marginTop: "10px",
                      padding: "8px",
                      backgroundColor: "#f8d7da",
                      color: "#721c24",
                      borderRadius: "4px",
                      fontSize: "0.85em",
                    }}
                  >
                    ❌ {server.error}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// Main example component
const MultiServerExample: React.FC = () => {
  return (
    <McpClientProvider
      defaultAutoProxyFallback={{
        enabled: true,
        proxyAddress: "http://localhost:3005/inspector/api/proxy",
      }}
    >
      <ServerManager />
    </McpClientProvider>
  );
};

export default MultiServerExample;
