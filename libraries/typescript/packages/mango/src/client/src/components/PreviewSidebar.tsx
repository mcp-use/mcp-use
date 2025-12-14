import { useEffect, useState, useRef } from "react";
import { useMcp } from "mcp-use/react";

interface FileNode {
  path: string;
  name: string;
  type: "file" | "directory";
  children?: FileNode[];
  content?: string;
  size?: number;
  truncated?: boolean;
}

interface ProjectFilesStructure {
  path: string;
  children: FileNode[];
}

interface PreviewSidebarProps {
  devServerUrl: string | null;
  conversationId: string;
}

export function PreviewSidebar({
  devServerUrl,
  conversationId,
}: PreviewSidebarProps) {
  const mcp = useMcp({
    url: devServerUrl || "",
    enabled: !!devServerUrl,
    // Note: autoRetry causes infinite loop issues, so we only use autoReconnect
    // which handles reconnection when an established connection is lost
    autoReconnect: 5000, // Reconnect after 5 seconds if connection is lost
  });

  // Project files state
  const [projectFiles, setProjectFiles] =
    useState<ProjectFilesStructure | null>(null);
  const [projectFilesLoading, setProjectFilesLoading] = useState(false);
  const [projectFilesError, setProjectFilesError] = useState<string | null>(
    null
  );
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  // Track if we were previously connected to detect server restarts
  const wasConnectedRef = useRef(false);

  // Reset connection tracking when dev server URL changes
  useEffect(() => {
    wasConnectedRef.current = false;
  }, [devServerUrl]);

  // Update the ref when state changes
  useEffect(() => {
    if (mcp.state === "ready") {
      wasConnectedRef.current = true;
    }
  }, [mcp.state]);

  // Status display logic
  const getStatusMessage = () => {
    if (mcp.state === "ready") {
      return "✓ Connected";
    }

    const wasConnected = wasConnectedRef.current;

    if (
      (mcp.state === "discovering" || mcp.state === "failed") &&
      wasConnected
    ) {
      return "🔄 Server restarting...";
    }

    // Original logic for initial connection attempts
    if (mcp.state === "discovering") {
      return "Connecting...";
    }

    if (mcp.state === "failed") {
      return "✗ Connection failed";
    }

    return mcp.state;
  };

  // Poll for updates every 3 seconds when connected
  useEffect(() => {
    if (mcp.state !== "ready") return;

    const interval = setInterval(async () => {
      try {
        // Refresh resources and prompts
        if (mcp.listResources) {
          await mcp.listResources();
        }
        if (mcp.listPrompts) {
          await mcp.listPrompts();
        }
        // Note: Tools are automatically refreshed by the MCP client
        // when the server sends tools/list_changed notifications
      } catch (error) {
        // Silently fail - don't spam console with refresh errors
        console.debug("Failed to refresh MCP lists:", error);
      }
    }, 3000); // Refresh every 3 seconds

    return () => clearInterval(interval);
  }, [mcp.state, mcp.listResources, mcp.listPrompts]);

  // Poll for project files every 5 seconds when dev server is available
  useEffect(() => {
    if (!devServerUrl || !conversationId) return;

    const fetchProjectFiles = async () => {
      setProjectFilesLoading(true);
      setProjectFilesError(null);
      try {
        const response = await fetch(
          `/api/chat/project-files?conversationId=${encodeURIComponent(conversationId)}`
        );
        if (!response.ok) {
          throw new Error(
            `Failed to fetch project files: ${response.statusText}`
          );
        }
        const data = await response.json();
        setProjectFiles(data);
      } catch (error: any) {
        console.error("Failed to fetch project files:", error);
        setProjectFilesError(error.message || "Failed to load project files");
      } finally {
        setProjectFilesLoading(false);
      }
    };

    // Fetch immediately
    fetchProjectFiles();

    // Then poll every 5 seconds
    const interval = setInterval(fetchProjectFiles, 5000);

    return () => clearInterval(interval);
  }, [devServerUrl, conversationId]);

  if (!devServerUrl) {
    return (
      <div
        style={{
          padding: "16px",
          color: "#666",
          fontSize: "14px",
          textAlign: "center",
        }}
      >
        Waiting for dev server to start...
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid #e0e0e0",
          backgroundColor: "#f8f9fa",
        }}
      >
        <h3 style={{ margin: 0, fontSize: "14px", fontWeight: "600" }}>
          Live Preview
        </h3>
        <div
          style={{
            fontSize: "11px",
            color: "#666",
            marginTop: "4px",
          }}
        >
          {getStatusMessage()}
        </div>
      </div>

      {mcp.state === "ready" && (
        <>
          <div style={{ padding: "12px 16px" }}>
            <h4
              style={{
                fontSize: "12px",
                fontWeight: "600",
                marginBottom: "8px",
              }}
            >
              Tools ({mcp.tools.length})
            </h4>
            {mcp.tools.length === 0 ? (
              <div
                style={{
                  fontSize: "11px",
                  color: "#999",
                  fontStyle: "italic",
                }}
              >
                No tools available yet
              </div>
            ) : (
              mcp.tools.map((tool) => (
                <div
                  key={tool.name}
                  style={{
                    padding: "8px",
                    backgroundColor: "#f9f9f9",
                    borderRadius: "4px",
                    marginBottom: "4px",
                    fontSize: "12px",
                  }}
                >
                  <div style={{ fontWeight: "500" }}>{tool.name}</div>
                  {tool.description && (
                    <div
                      style={{
                        color: "#666",
                        fontSize: "11px",
                        marginTop: "2px",
                      }}
                    >
                      {tool.description}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          <div style={{ padding: "12px 16px" }}>
            <h4
              style={{
                fontSize: "12px",
                fontWeight: "600",
                marginBottom: "8px",
              }}
            >
              Resources ({mcp.resources.length})
            </h4>
            {mcp.resources.length === 0 ? (
              <div
                style={{
                  fontSize: "11px",
                  color: "#999",
                  fontStyle: "italic",
                }}
              >
                No resources available yet
              </div>
            ) : (
              mcp.resources.map((resource) => (
                <div
                  key={resource.uri}
                  style={{
                    padding: "8px",
                    backgroundColor: "#f9f9f9",
                    borderRadius: "4px",
                    marginBottom: "4px",
                    fontSize: "12px",
                  }}
                >
                  <div style={{ fontWeight: "500" }}>
                    {resource.name || resource.uri}
                  </div>
                  <div
                    style={{
                      color: "#666",
                      fontSize: "10px",
                      marginTop: "2px",
                    }}
                  >
                    {resource.uri}
                  </div>
                </div>
              ))
            )}
          </div>

          {mcp.prompts && mcp.prompts.length > 0 && (
            <div style={{ padding: "12px 16px" }}>
              <h4
                style={{
                  fontSize: "12px",
                  fontWeight: "600",
                  marginBottom: "8px",
                }}
              >
                Prompts ({mcp.prompts.length})
              </h4>
              {mcp.prompts.map((prompt) => (
                <div
                  key={prompt.name}
                  style={{
                    padding: "8px",
                    backgroundColor: "#f9f9f9",
                    borderRadius: "4px",
                    marginBottom: "4px",
                    fontSize: "12px",
                  }}
                >
                  <div style={{ fontWeight: "500" }}>{prompt.name}</div>
                  {prompt.description && (
                    <div
                      style={{
                        color: "#666",
                        fontSize: "11px",
                        marginTop: "2px",
                      }}
                    >
                      {prompt.description}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Project Files Section */}
          <div style={{ padding: "12px 16px", borderTop: "1px solid #e0e0e0" }}>
            <h4
              style={{
                fontSize: "12px",
                fontWeight: "600",
                marginBottom: "8px",
              }}
            >
              Project Files
            </h4>
            {projectFilesLoading && !projectFiles && (
              <div
                style={{
                  fontSize: "11px",
                  color: "#999",
                  fontStyle: "italic",
                }}
              >
                Loading...
              </div>
            )}
            {projectFilesError && (
              <div
                style={{
                  fontSize: "11px",
                  color: "#c00",
                  backgroundColor: "#fee",
                  padding: "8px",
                  borderRadius: "4px",
                }}
              >
                {projectFilesError}
              </div>
            )}
            {projectFiles && projectFiles.children && (
              <FileTreeView
                nodes={projectFiles.children}
                expandedPaths={expandedPaths}
                onToggleExpand={(path) => {
                  const newExpanded = new Set(expandedPaths);
                  if (newExpanded.has(path)) {
                    newExpanded.delete(path);
                  } else {
                    newExpanded.add(path);
                  }
                  setExpandedPaths(newExpanded);
                }}
                selectedFile={selectedFile}
                onSelectFile={(path) => setSelectedFile(path)}
              />
            )}
            {selectedFile && projectFiles && (
              <FileContentViewer
                file={findFileByPath(projectFiles, selectedFile)}
                onClose={() => setSelectedFile(null)}
              />
            )}
          </div>
        </>
      )}

      {mcp.error && (
        <div
          style={{
            padding: "12px 16px",
            color: "#c00",
            fontSize: "12px",
            backgroundColor: "#fee",
          }}
        >
          Error: {mcp.error}
        </div>
      )}
    </div>
  );
}

// Helper function to find a file by path
function findFileByPath(
  structure: ProjectFilesStructure,
  targetPath: string
): FileNode | null {
  function search(nodes: FileNode[]): FileNode | null {
    for (const node of nodes) {
      if (node.path === targetPath) {
        return node;
      }
      if (node.children) {
        const found = search(node.children);
        if (found) return found;
      }
    }
    return null;
  }
  return search(structure.children);
}

// File Tree View Component
interface FileTreeViewProps {
  nodes: FileNode[];
  expandedPaths: Set<string>;
  onToggleExpand: (path: string) => void;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  level?: number;
}

function FileTreeView({
  nodes,
  expandedPaths,
  onToggleExpand,
  selectedFile,
  onSelectFile,
  level = 0,
}: FileTreeViewProps) {
  return (
    <div style={{ fontSize: "11px" }}>
      {nodes.map((node) => {
        const isExpanded = expandedPaths.has(node.path);
        const isSelected = selectedFile === node.path;
        const hasChildren = node.children && node.children.length > 0;

        return (
          <div key={node.path}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "4px 0",
                paddingLeft: `${level * 12}px`,
                cursor: node.type === "file" ? "pointer" : "default",
                backgroundColor: isSelected ? "#e3f2fd" : "transparent",
                borderRadius: "2px",
              }}
              onClick={() => {
                if (node.type === "file") {
                  onSelectFile(node.path);
                } else if (hasChildren) {
                  onToggleExpand(node.path);
                }
              }}
            >
              <span style={{ marginRight: "4px", fontSize: "12px" }}>
                {node.type === "directory" ? (isExpanded ? "📂" : "📁") : "📄"}
              </span>
              <span
                style={{
                  fontWeight: node.type === "directory" ? "500" : "400",
                  color: isSelected ? "#1976d2" : "#333",
                }}
              >
                {node.name}
              </span>
              {node.type === "file" && node.size !== undefined && (
                <span
                  style={{
                    marginLeft: "8px",
                    color: "#999",
                    fontSize: "10px",
                  }}
                >
                  ({formatFileSize(node.size)})
                </span>
              )}
            </div>
            {node.type === "directory" &&
              hasChildren &&
              isExpanded &&
              node.children && (
                <FileTreeView
                  nodes={node.children}
                  expandedPaths={expandedPaths}
                  onToggleExpand={onToggleExpand}
                  selectedFile={selectedFile}
                  onSelectFile={onSelectFile}
                  level={level + 1}
                />
              )}
          </div>
        );
      })}
    </div>
  );
}

// File Content Viewer Component
interface FileContentViewerProps {
  file: FileNode | null;
  onClose: () => void;
}

function FileContentViewer({ file, onClose }: FileContentViewerProps) {
  if (!file || file.type !== "file") return null;

  return (
    <div
      style={{
        marginTop: "12px",
        border: "1px solid #e0e0e0",
        borderRadius: "4px",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "8px 12px",
          backgroundColor: "#f8f9fa",
          borderBottom: "1px solid #e0e0e0",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ fontSize: "11px", fontWeight: "500" }}>{file.name}</div>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: "16px",
            color: "#666",
            padding: "0 4px",
          }}
        >
          ×
        </button>
      </div>
      <div
        style={{
          padding: "12px",
          maxHeight: "300px",
          overflowY: "auto",
          backgroundColor: "#fafafa",
        }}
      >
        {file.content !== undefined ? (
          <>
            {file.truncated && (
              <div
                style={{
                  fontSize: "10px",
                  color: "#f57c00",
                  marginBottom: "8px",
                  padding: "4px 8px",
                  backgroundColor: "#fff3e0",
                  borderRadius: "2px",
                }}
              >
                ⚠️ File truncated (showing first 50KB)
              </div>
            )}
            <pre
              style={{
                margin: 0,
                fontSize: "10px",
                fontFamily: "monospace",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                color: "#333",
              }}
            >
              {file.content}
            </pre>
          </>
        ) : (
          <div
            style={{
              fontSize: "11px",
              color: "#999",
              fontStyle: "italic",
            }}
          >
            {file.size !== undefined && file.size > 50 * 1024
              ? "File too large to display"
              : "Binary file or content not available"}
          </div>
        )}
      </div>
    </div>
  );
}

// Helper function to format file size
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
