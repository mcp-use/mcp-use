import { McpClientProvider, useMcpClient } from "@mcp-use/client/react";
import React, { useEffect } from "react";

/**
 * Multi-server McpClientProvider against all four local demo servers.
 * See examples/_demo-servers/package.json for start commands.
 */

const ServerManager: React.FC = () => {
  const { addServer, removeServer, servers } = useMcpClient();

  useEffect(() => {
    // Stateful v1: auto negotiation probes, falls back to the legacy
    // initialize/session handshake, and maintains the GET/SSE stream.
    addServer("official-v1", {
      url: "http://127.0.0.1:3101/mcp",
    });

    addServer("official-v2", {
      url: "http://127.0.0.1:3102/mcp",
    });

    addServer("mcp-use-v1", {
      url: "http://127.0.0.1:3103/mcp",
      roots: [{ uri: "file:///tmp/mcp-use-browser", name: "Browser demo" }],
      clientOptions: { capabilities: { views: true } },
    });

    addServer("mcp-use-v2", {
      // Same-origin Vite proxy: the v2 reference server intentionally owns
      // Origin validation but does not emit browser CORS headers.
      url: `${window.location.origin}/demo/mcp-use-v2`,
      clientOptions: { capabilities: { views: true } },
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
                      {server.protocolEra && (
                        <>
                          {" "}
                          · Era:{" "}
                          <span style={{ fontWeight: "bold" }}>
                            {server.protocolEra}
                          </span>
                          {server.protocolVersion && (
                            <> ({server.protocolVersion})</>
                          )}
                        </>
                      )}
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

                {/* Authentication Actions */}
                {server.state === "pending_auth" && (
                  <div style={{ marginTop: "10px" }}>
                    <button
                      onClick={() => server.authenticate()}
                      style={{
                        padding: "10px 20px",
                        marginRight: "10px",
                        backgroundColor: "#28a745",
                        color: "white",
                        border: "none",
                        borderRadius: "4px",
                        cursor: "pointer",
                      }}
                    >
                      Start Authentication
                    </button>

                    {server.authUrl && (
                      <a
                        href={server.authUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: "inline-block",
                          padding: "10px 20px",
                          backgroundColor: "#6c757d",
                          color: "white",
                          borderRadius: "4px",
                          textDecoration: "none",
                        }}
                      >
                        Open Auth URL
                      </a>
                    )}
                  </div>
                )}

                {server.state === "failed" && (
                  <div style={{ marginTop: "10px" }}>
                    <button
                      onClick={() => server.retry()}
                      style={{
                        padding: "10px 20px",
                        backgroundColor: "#007bff",
                        color: "white",
                        border: "none",
                        borderRadius: "4px",
                        cursor: "pointer",
                      }}
                    >
                      Retry Connection
                    </button>
                  </div>
                )}

                {/* Authenticating State */}
                {server.state === "authenticating" && (
                  <div
                    style={{
                      marginTop: "10px",
                      padding: "10px",
                      backgroundColor: "#fff3cd",
                      border: "1px solid #ffc107",
                      borderRadius: "4px",
                    }}
                  >
                    <strong>⏳ Authenticating...</strong>
                    <p style={{ margin: "10px 0 0 0" }}>
                      Please complete the authentication in the popup window.
                    </p>
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
    <McpClientProvider enableRpcLogging={false}>
      <ServerManager />
    </McpClientProvider>
  );
};

export default MultiServerExample;
