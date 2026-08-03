import { McpClientProvider, useMcpClient } from "@mcp-use/client/react";
import type { McpServer } from "@mcp-use/client/react";
import React, { useCallback, useState } from "react";

/**
 * Dynamically add MCP servers after mount via `addServer`.
 *
 * Try local demos (start under examples/_demo-servers) or OAuth remotes:
 *   VITE_MCP_URL=https://mcp.linear.app/mcp pnpm dev
 */

const DEFAULT_URL = import.meta.env.VITE_MCP_URL ?? "http://127.0.0.1:3102/mcp";

const PRESETS: { label: string; url: string }[] = [
  { label: "official v2 (3102)", url: "http://127.0.0.1:3102/mcp" },
  { label: "official v1 (3101)", url: "http://127.0.0.1:3101/mcp" },
  { label: "mcp-use v2 (3104 proxy)", url: "/demo/mcp-use-v2" },
  { label: "Linear OAuth", url: "https://mcp.linear.app/mcp" },
];

function serverIdFromUrl(url: string): string {
  try {
    const parsed = new URL(url, window.location.origin);
    const host = parsed.hostname.replace(/\./g, "-");
    const path =
      parsed.pathname === "/" || parsed.pathname === "/mcp"
        ? ""
        : parsed.pathname.replace(/\//g, "-");
    return `${host}${path}` || "server";
  } catch {
    return `server-${Date.now()}`;
  }
}

const btn = (
  bg: string,
  opts?: { disabled?: boolean; marginRight?: number }
): React.CSSProperties => ({
  padding: "8px 14px",
  backgroundColor: opts?.disabled ? "#adb5bd" : bg,
  color: "white",
  border: "none",
  borderRadius: "4px",
  cursor: opts?.disabled ? "not-allowed" : "pointer",
  marginRight: opts?.marginRight ?? 0,
});

function isLocalMcpUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

function ConnectionActions({
  server,
  onRemove,
}: {
  server: McpServer;
  onRemove: () => void;
}) {
  const likelyOAuth =
    !server.authTokens &&
    !isLocalMcpUrl(server.url) &&
    server.state !== "ready";

  const showAuthRequired =
    likelyOAuth &&
    (server.state === "pending_auth" || server.state === "authenticating");

  const showDisconnect =
    server.state === "ready" &&
    !!server.authTokens &&
    typeof server.clearStorage === "function";

  if (showAuthRequired) {
    return (
      <div
        style={{
          marginTop: "10px",
          display: "flex",
          gap: "8px",
          flexWrap: "wrap",
        }}
      >
        {server.state === "authenticating" ? (
          <button
            type="button"
            disabled
            style={btn("#ffc107", { disabled: true })}
          >
            Authenticating…
          </button>
        ) : (
          <button
            type="button"
            style={btn("#ffc107")}
            onClick={() => void server.authenticate()}
          >
            Authenticate
          </button>
        )}
        {server.authUrl && (
          <a
            href={server.authUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: "0.85em", alignSelf: "center" }}
          >
            Open auth URL
          </a>
        )}
      </div>
    );
  }

  if (server.state === "ready") {
    return (
      <div
        style={{
          marginTop: "10px",
          display: "flex",
          gap: "8px",
          flexWrap: "wrap",
        }}
      >
        <span
          style={{ fontSize: "0.9em", color: "#28a745", alignSelf: "center" }}
        >
          Connected
          {server.authTokens ? " · authenticated" : ""}
        </span>
        {showDisconnect && (
          <button
            type="button"
            style={btn("#6c757d")}
            onClick={() => server.clearStorage()}
          >
            Disconnect
          </button>
        )}
        <button type="button" style={btn("#dc3545")} onClick={onRemove}>
          Remove
        </button>
      </div>
    );
  }

  if (server.state === "failed") {
    return (
      <div
        style={{
          marginTop: "10px",
          display: "flex",
          gap: "8px",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          style={btn("#007bff")}
          onClick={() => server.retry()}
        >
          Retry
        </button>
        {server.authenticate && (
          <button
            type="button"
            style={btn("#28a745")}
            onClick={() => void server.authenticate()}
          >
            Authenticate
          </button>
        )}
        <button type="button" style={btn("#dc3545")} onClick={onRemove}>
          Remove
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: "10px", fontSize: "0.9em", color: "#6c757d" }}>
      {likelyOAuth ? "Discovering OAuth server…" : "Connecting…"}
    </div>
  );
}

const DynamicServerManager: React.FC = () => {
  const { addServer, removeServer, servers } = useMcpClient();
  const [urlInput, setUrlInput] = useState(DEFAULT_URL);
  const [idInput, setIdInput] = useState("");

  const handleAdd = useCallback(() => {
    const url = urlInput.trim();
    if (!url) return;

    const resolvedUrl = url.startsWith("/")
      ? `${window.location.origin}${url}`
      : url;
    const id = idInput.trim() || serverIdFromUrl(resolvedUrl);

    if (servers.some((s) => s.id === id)) {
      window.alert(
        `Server id "${id}" is already connected. Pick a different id.`
      );
      return;
    }

    addServer(id, { url: resolvedUrl });
    setIdInput("");
  }, [addServer, idInput, servers, urlInput]);

  const handleRemove = useCallback(
    (id: string, clearCredentials = false) => {
      void removeServer(
        id,
        clearCredentials ? { clearCredentials: true } : undefined
      );
    },
    [removeServer]
  );

  return (
    <div style={{ padding: "20px", fontFamily: "Arial, sans-serif" }}>
      <h1>Dynamic Server Addition</h1>

      <p>
        Add MCP servers at runtime with <code>addServer</code>. Use the presets
        or paste any streamable-HTTP URL — OAuth servers (e.g. Linear) show{" "}
        <strong>Authenticate</strong> / <strong>Disconnect</strong> like the
        cloud dashboard.
      </p>

      <div
        style={{
          marginBottom: "24px",
          padding: "16px",
          border: "1px solid #dee2e6",
          borderRadius: "4px",
          backgroundColor: "#f8f9fa",
        }}
      >
        <h2 style={{ marginTop: 0 }}>Add server</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <label
            style={{ display: "flex", flexDirection: "column", gap: "4px" }}
          >
            <span style={{ fontSize: "0.85em", fontWeight: "bold" }}>
              MCP URL
            </span>
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="http://127.0.0.1:3102/mcp"
              style={{
                padding: "8px",
                borderRadius: "4px",
                border: "1px solid #ced4da",
                fontFamily: "monospace",
              }}
            />
          </label>
          <label
            style={{ display: "flex", flexDirection: "column", gap: "4px" }}
          >
            <span style={{ fontSize: "0.85em", fontWeight: "bold" }}>
              Server id (optional)
            </span>
            <input
              type="text"
              value={idInput}
              onChange={(e) => setIdInput(e.target.value)}
              placeholder={serverIdFromUrl(urlInput.trim() || DEFAULT_URL)}
              style={{
                padding: "8px",
                borderRadius: "4px",
                border: "1px solid #ced4da",
                fontFamily: "monospace",
              }}
            />
          </label>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button type="button" style={btn("#007bff")} onClick={handleAdd}>
              Add server
            </button>
          </div>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                style={{
                  ...btn("#e9ecef"),
                  color: "#212529",
                  fontSize: "0.8em",
                }}
                onClick={() => {
                  const url = preset.url.startsWith("/")
                    ? `${window.location.origin}${preset.url}`
                    : preset.url;
                  setUrlInput(url);
                  setIdInput(serverIdFromUrl(url));
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <h2>Connected servers ({servers.length})</h2>
      {servers.length === 0 ? (
        <p style={{ color: "#6c757d" }}>No servers yet — add one above.</p>
      ) : (
        servers.map((server) => (
          <div
            key={server.id}
            style={{
              border: "1px solid #dee2e6",
              borderRadius: "4px",
              padding: "15px",
              backgroundColor: "#fff",
              marginBottom: "12px",
            }}
          >
            <h3 style={{ margin: "0 0 4px 0" }}>
              {server.serverInfo?.name || server.id}
            </h3>
            <div style={{ fontSize: "0.85em", color: "#6c757d" }}>
              id: <code>{server.id}</code>
            </div>
            <div
              style={{ fontSize: "0.9em", color: "#6c757d", marginTop: "4px" }}
            >
              State:{" "}
              <span
                style={{
                  fontWeight: "bold",
                  color:
                    server.state === "ready"
                      ? "#28a745"
                      : server.state === "failed"
                        ? "#dc3545"
                        : "#ffc107",
                }}
              >
                {server.state}
              </span>
              {server.protocolEra && (
                <>
                  {" "}
                  · {server.protocolEra}
                  {server.protocolVersion ? ` (${server.protocolVersion})` : ""}
                </>
              )}
            </div>

            {server.state === "ready" && (
              <div style={{ fontSize: "0.9em", marginTop: "8px" }}>
                Tools: {server.tools.length} · Resources:{" "}
                {server.resources.length} · Prompts: {server.prompts.length}
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

            <ConnectionActions
              server={server}
              onRemove={() => handleRemove(server.id, !!server.authTokens)}
            />
          </div>
        ))
      )}
    </div>
  );
};

const DynamicServerExample: React.FC = () => {
  return (
    <McpClientProvider enableRpcLogging={false}>
      <DynamicServerManager />
    </McpClientProvider>
  );
};

export default DynamicServerExample;
