import { McpClientProvider, useMcpClient } from "@mcp-use/client/react";
import React, { useEffect, useState } from "react";

/**
 * Dynamically add an MCP server after mount (idempotent addServer).
 * Defaults to the local v2 demo — start: cd ../../_demo-servers && PORT=3102 pnpm v2
 */

const MCP_SERVER_URL =
  import.meta.env.VITE_MCP_URL ?? "http://127.0.0.1:3102/mcp";

const ProtectedRoute: React.FC = () => {
  const { addServer, servers } = useMcpClient();
  const [isAuthenticated] = useState(true);

  useEffect(() => {
    if (isAuthenticated) {
      addServer("my-server", {
        url: MCP_SERVER_URL,
      });
    }
  }, [addServer, isAuthenticated]);

  return (
    <div style={{ padding: "20px", fontFamily: "Arial, sans-serif" }}>
      <h1>Dynamic Server Addition</h1>

      <p>
        This example shows how to dynamically add an MCP server after mount
        using <code>addServer</code>, mimicking a protected-route pattern where
        the server is only added after authentication. <code>addServer</code> is
        idempotent&mdash;calling it multiple times with the same id is safe.
      </p>

      <div style={{ marginBottom: "20px" }}>
        <h2>Server Status</h2>
        {servers.length === 0 ? (
          <p style={{ color: "#6c757d" }}>Connecting to {MCP_SERVER_URL}...</p>
        ) : (
          servers.map((server) => (
            <div
              key={server.id}
              style={{
                border: "1px solid #dee2e6",
                borderRadius: "4px",
                padding: "15px",
                backgroundColor: "#f8f9fa",
                marginBottom: "10px",
              }}
            >
              <h3 style={{ margin: "0 0 5px 0" }}>
                {server.serverInfo?.name || server.id}
              </h3>
              <div style={{ fontSize: "0.9em", color: "#6c757d" }}>
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
                    {server.protocolVersion && <> ({server.protocolVersion})</>}
                  </>
                )}
              </div>
              {server.state === "ready" && (
                <div style={{ fontSize: "0.9em", marginTop: "8px" }}>
                  Tools: {server.tools.length} | Resources:{" "}
                  {server.resources.length} | Prompts: {server.prompts.length}
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
                  {server.error}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div
        style={{
          padding: "16px",
          backgroundColor: "#f8f9fa",
          borderRadius: "4px",
          fontSize: "0.85em",
        }}
      >
        <strong>Config used:</strong>
        <pre style={{ margin: "8px 0 0 0" }}>
          {JSON.stringify(
            {
              addServer: {
                url: MCP_SERVER_URL,
              },
            },
            null,
            2
          )}
        </pre>
      </div>
    </div>
  );
};

const DynamicServerExample: React.FC = () => {
  return (
    <McpClientProvider enableRpcLogging={false}>
      <ProtectedRoute />
    </McpClientProvider>
  );
};

export default DynamicServerExample;
