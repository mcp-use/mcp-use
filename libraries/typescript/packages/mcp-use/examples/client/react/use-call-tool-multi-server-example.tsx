import {
  McpClientProvider,
  useMcpClient,
  useMcpServer,
  useCallTool,
  type TypedMcpServer,
} from "mcp-use/react";
import React, { useEffect } from "react";

/**
 * Example demonstrating useCallTool with McpClientProvider (multi-server)
 *
 * This example shows how to use the useCallTool hook when managing multiple
 * MCP servers through McpClientProvider with full type safety.
 *
 * Key concepts:
 * - McpClientProvider manages multiple servers
 * - useMcpServer(id) gets a specific server connection
 * - Pass server object directly to useCallTool
 * - Use ToolRegistry for autocomplete support
 */

// ============================================================
// Define tool registries for each server
// ============================================================

type LinearTools = {
  "create-issue": {
    input: { title: string; description: string; projectId: string };
    output: { id: string; title: string; url: string; status: string };
  };
  "list-issues": {
    input: { projectId: string; limit?: number };
    output: { issues: Array<{ id: string; title: string }> };
  };
  "update-issue": {
    input: { issueId: string; status: string };
    output: { success: boolean };
  };
};

type VercelTools = {
  "deploy-project": {
    input: { project: string; branch: string };
    output: { id: string; url: string; status: "ready" | "building" | "error" };
  };
  "list-deployments": {
    input: { project: string };
    output: { deployments: Array<{ id: string; status: string }> };
  };
};

// ============================================================
// Server-specific components
// ============================================================

const LinearToolsComponent: React.FC = () => {
  const linearServer = useMcpServer("linear");

  // Cast to typed server for autocomplete
  const typedServer = linearServer as TypedMcpServer<LinearTools> | null;

  // Tool names autocomplete!
  const createIssueHook = useCallTool(
    typedServer,
    "create-issue", // <-- autocompletes: "create-issue", "list-issues", "update-issue"
    {
      onSuccess: (data) => {
        console.log("Issue created:", data.url);
      },
      onError: (error) => {
        console.error("Failed to create issue:", error);
      },
    }
  );

  const handleCreateIssue = async () => {
    try {
      const result = await createIssueHook.callToolAsync({
        title: "Test Issue from useCallTool",
        description: "Created using the unified useCallTool hook",
        projectId: "proj_123",
      });
      alert(`Issue created: ${result.url}`);
    } catch (error) {
      console.error("Error:", error);
    }
  };

  if (!linearServer) {
    return (
      <div
        style={{
          padding: "15px",
          backgroundColor: "#fff3cd",
          borderRadius: "4px",
        }}
      >
        <p>⏳ Linear server not connected yet...</p>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: "20px",
        border: "1px solid #dee2e6",
        borderRadius: "8px",
        backgroundColor: "#f8f9fa",
        marginBottom: "20px",
      }}
    >
      <h3>Linear Server Tools</h3>
      <div style={{ marginBottom: "10px", fontSize: "0.9em" }}>
        <strong>Server Status:</strong>{" "}
        <span
          style={{
            color: linearServer.state === "ready" ? "#28a745" : "#ffc107",
            fontWeight: "bold",
          }}
        >
          {linearServer.state}
        </span>
      </div>

      {linearServer.state === "ready" && (
        <>
          <p style={{ fontSize: "0.9em", color: "#6c757d" }}>
            Tools available: {linearServer.tools.length}
          </p>

          <button
            onClick={handleCreateIssue}
            disabled={createIssueHook.isPending}
            style={{
              padding: "10px 20px",
              backgroundColor: createIssueHook.isPending
                ? "#6c757d"
                : "#007bff",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: createIssueHook.isPending ? "not-allowed" : "pointer",
              marginBottom: "10px",
            }}
          >
            {createIssueHook.isPending ? "Creating..." : "Create Test Issue"}
          </button>

          <div style={{ fontSize: "0.85em", marginTop: "10px" }}>
            <strong>Hook States:</strong> {createIssueHook.isIdle && "⚪ Idle "}
            {createIssueHook.isPending && "🟡 Pending "}
            {createIssueHook.isSuccess && "🟢 Success "}
            {createIssueHook.isError && "🔴 Error "}
          </div>

          {createIssueHook.isSuccess && createIssueHook.data && (
            <div
              style={{
                marginTop: "15px",
                padding: "10px",
                backgroundColor: "#d4edda",
                border: "1px solid #c3e6cb",
                borderRadius: "4px",
                fontSize: "0.9em",
              }}
            >
              <p>
                <strong>✓ Issue Created!</strong>
              </p>
              <p>ID: {createIssueHook.data.id}</p>
              <p>
                URL:{" "}
                <a
                  href={createIssueHook.data.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {createIssueHook.data.url}
                </a>
              </p>
            </div>
          )}

          {createIssueHook.isError && createIssueHook.error && (
            <div
              style={{
                marginTop: "15px",
                padding: "10px",
                backgroundColor: "#f8d7da",
                border: "1px solid #f5c6cb",
                borderRadius: "4px",
                fontSize: "0.9em",
                color: "#721c24",
              }}
            >
              <strong>Error:</strong> {createIssueHook.error.message}
            </div>
          )}
        </>
      )}
    </div>
  );
};

const VercelToolsComponent: React.FC = () => {
  const vercelServer = useMcpServer("vercel");

  // Cast to typed server for autocomplete
  const typedServer = vercelServer as TypedMcpServer<VercelTools> | null;

  // Tool names autocomplete!
  const deployHook = useCallTool(
    typedServer,
    "deploy-project", // <-- autocompletes: "deploy-project", "list-deployments"
    {
      timeout: 60000,
      onSuccess: (data) => {
        console.log("Deployment successful:", data.url);
      },
    }
  );

  if (!vercelServer) {
    return (
      <div
        style={{
          padding: "15px",
          backgroundColor: "#fff3cd",
          borderRadius: "4px",
        }}
      >
        <p>⏳ Vercel server not connected yet...</p>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: "20px",
        border: "1px solid #dee2e6",
        borderRadius: "8px",
        backgroundColor: "#f8f9fa",
        marginBottom: "20px",
      }}
    >
      <h3>Vercel Server Tools</h3>
      <div style={{ marginBottom: "10px", fontSize: "0.9em" }}>
        <strong>Server Status:</strong>{" "}
        <span
          style={{
            color: vercelServer.state === "ready" ? "#28a745" : "#ffc107",
            fontWeight: "bold",
          }}
        >
          {vercelServer.state}
        </span>
      </div>

      {vercelServer.state === "ready" && (
        <>
          <p style={{ fontSize: "0.9em", color: "#6c757d" }}>
            Tools available: {vercelServer.tools.length}
          </p>

          <button
            onClick={() =>
              deployHook.callTool({ project: "my-app", branch: "main" })
            }
            disabled={deployHook.isPending}
            style={{
              padding: "10px 20px",
              backgroundColor: deployHook.isPending ? "#6c757d" : "#000000",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: deployHook.isPending ? "not-allowed" : "pointer",
            }}
          >
            {deployHook.isPending ? "Deploying..." : "Deploy to Vercel"}
          </button>

          {deployHook.isSuccess && deployHook.data && (
            <div
              style={{
                marginTop: "15px",
                padding: "10px",
                backgroundColor: "#d4edda",
                border: "1px solid #c3e6cb",
                borderRadius: "4px",
                fontSize: "0.9em",
              }}
            >
              <p>
                <strong>✓ Deployed!</strong>
              </p>
              <p>Status: {deployHook.data.status}</p>
              <p>
                URL:{" "}
                <a
                  href={deployHook.data.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {deployHook.data.url}
                </a>
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
};

// ============================================================
// Main component
// ============================================================

const ServerManager: React.FC = () => {
  const { addServer, servers } = useMcpClient();

  useEffect(() => {
    addServer("linear", {
      url: "https://mcp.linear.app/mcp",
      name: "Linear",
      timeout: 30000,
    });

    addServer("vercel", {
      url: "https://mcp.vercel.com",
      name: "Vercel",
      timeout: 30000,
    });

    addServer("weather-api", {
      url: "http://localhost:3000/mcp",
      name: "Weather API (Local)",
    });
  }, [addServer]);

  return (
    <div style={{ padding: "20px", fontFamily: "Arial, sans-serif" }}>
      <h1>useCallTool with Multiple Servers</h1>

      <div
        style={{
          marginBottom: "20px",
          padding: "15px",
          backgroundColor: "#e7f3ff",
          border: "1px solid #b3d9ff",
          borderRadius: "4px",
        }}
      >
        <h3>New API - Pass Server Object Directly</h3>
        <ol style={{ marginBottom: 0 }}>
          <li>
            Use <code>useMcpServer(id)</code> to get a server
          </li>
          <li>
            Cast to typed server:{" "}
            <code>server as TypedMcpServer&lt;MyTools&gt;</code>
          </li>
          <li>
            Pass server to <code>useCallTool(typedServer, 'tool-name')</code>
          </li>
          <li>
            Get <strong>autocomplete</strong> for tool names! 🎉
          </li>
        </ol>
      </div>

      {/* Server Status Overview */}
      <div style={{ marginBottom: "30px" }}>
        <h2>Connected Servers ({servers.length})</h2>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          {servers.map((server) => (
            <div
              key={server.id}
              style={{
                padding: "10px 15px",
                border: "1px solid #dee2e6",
                borderRadius: "4px",
                backgroundColor:
                  server.state === "ready" ? "#d4edda" : "#fff3cd",
              }}
            >
              <div style={{ fontWeight: "bold" }}>
                {server.serverInfo?.name || server.id}
              </div>
              <div style={{ fontSize: "0.85em", color: "#6c757d" }}>
                {server.state}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Server Tool Sections */}
      <LinearToolsComponent />
      <VercelToolsComponent />

      {/* Code Example */}
      <div
        style={{
          marginTop: "30px",
          padding: "20px",
          backgroundColor: "#f8f9fa",
          border: "1px solid #dee2e6",
          borderRadius: "4px",
        }}
      >
        <h3>📝 Code Example</h3>
        <pre
          style={{
            backgroundColor: "#ffffff",
            padding: "15px",
            borderRadius: "4px",
            overflow: "auto",
            fontSize: "0.85em",
            border: "1px solid #dee2e6",
          }}
        >
          {`// 1. Define tool registry for autocomplete
type LinearTools = {
  'create-issue': { input: {...}; output: {...} };
  'list-issues': { input: {...}; output: {...} };
};

// 2. Get server from McpClientProvider
const linearServer = useMcpServer("linear");

// 3. Cast to typed server for autocomplete
const typedServer = linearServer as TypedMcpServer<LinearTools>;

// 4. Use useCallTool with server object
const hook = useCallTool(typedServer, "create-issue"); // autocompletes!

// 5. Input and output types are automatically inferred
await hook.callToolAsync({
  title: "Bug",        // <-- typed!
  description: "...",  // <-- typed!
});`}
        </pre>

        <h4>Key Benefits:</h4>
        <ul>
          <li>
            ✅ <strong>Pass server object directly</strong> - cleaner API
          </li>
          <li>
            ✅ <strong>Tool name autocomplete</strong> - via ToolRegistry
          </li>
          <li>
            ✅ <strong>Automatic type inference</strong> - input/output types
          </li>
          <li>✅ Manage multiple MCP servers simultaneously</li>
          <li>✅ Each server has isolated state and tools</li>
        </ul>
      </div>
    </div>
  );
};

// Root component with provider
const UseCallToolMultiServerExample: React.FC = () => {
  return (
    <McpClientProvider>
      <ServerManager />
    </McpClientProvider>
  );
};

export default UseCallToolMultiServerExample;
