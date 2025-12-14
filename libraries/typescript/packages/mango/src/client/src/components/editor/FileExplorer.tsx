import { useEffect, useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
} from "lucide-react";
import { cn } from "../../lib/utils";

interface FileNode {
  path: string;
  name: string;
  type: "file" | "directory";
  depth: number;
}

interface FileExplorerProps {
  conversationId: string;
  onFileSelect: (filePath: string) => void;
  selectedFile: string | null;
}

export function FileExplorer({
  conversationId,
  onFileSelect,
  selectedFile,
}: FileExplorerProps) {
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set([""]));
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!conversationId) return;

    const fetchFileTree = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(
          `/api/files/tree?conversationId=${conversationId}`
        );
        const data = await response.json();

        if (data.tree) {
          setFileTree(data.tree);
        } else if (data.error) {
          // Sandbox not ready yet - this is expected early in the conversation
          if (!data.error.includes("Sandbox not found")) {
            console.error("Error fetching file tree:", data.error);
          }
        }
      } catch (error) {
        console.error("Error fetching file tree:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchFileTree();
    const interval = setInterval(fetchFileTree, 5000); // Poll every 5 seconds

    return () => clearInterval(interval);
  }, [conversationId]);

  const toggleDirectory = (path: string) => {
    const newExpanded = new Set(expandedDirs);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedDirs(newExpanded);
  };

  const isDirectoryExpanded = (path: string) => {
    return expandedDirs.has(path);
  };

  const isChildVisible = (node: FileNode) => {
    if (node.depth === 0) return true;

    const pathParts = node.path.split("/");
    for (let i = 1; i < pathParts.length; i++) {
      const parentPath = pathParts.slice(0, i).join("/");
      if (!expandedDirs.has(parentPath)) {
        return false;
      }
    }
    return true;
  };

  if (isLoading && fileTree.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-sm text-gray-500">Loading files...</div>
      </div>
    );
  }

  if (fileTree.length === 0) {
    return (
      <div className="flex items-center justify-center h-full p-4">
        <div className="text-center">
          <Folder className="w-12 h-12 text-gray-400 mx-auto mb-2" />
          <p className="text-sm text-gray-500">
            {isLoading ? "Loading files..." : "Waiting for sandbox..."}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Files will appear once the agent creates the MCP project
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-white border-r border-gray-200">
      <div className="p-3">
        <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">
          Files
        </h3>
        <div className="space-y-0.5">
          {fileTree.filter(isChildVisible).map((node) => {
            const isExpanded = isDirectoryExpanded(node.path);
            const isSelected = selectedFile === node.path;

            return (
              <div key={node.path}>
                {node.type === "directory" ? (
                  <button
                    onClick={() => toggleDirectory(node.path)}
                    className={cn(
                      "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-gray-100 transition-colors text-left",
                      isExpanded && "bg-gray-50"
                    )}
                    style={{ paddingLeft: `${node.depth * 16 + 8}px` }}
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 text-gray-500 flex-shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-gray-500 flex-shrink-0" />
                    )}
                    {isExpanded ? (
                      <FolderOpen className="w-4 h-4 text-blue-500 flex-shrink-0" />
                    ) : (
                      <Folder className="w-4 h-4 text-blue-500 flex-shrink-0" />
                    )}
                    <span className="text-gray-700 truncate">{node.name}</span>
                  </button>
                ) : (
                  <button
                    onClick={() => onFileSelect(node.path)}
                    className={cn(
                      "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-gray-100 transition-colors text-left",
                      isSelected && "bg-blue-50 hover:bg-blue-100"
                    )}
                    style={{ paddingLeft: `${node.depth * 16 + 32}px` }}
                  >
                    <File className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <span
                      className={cn(
                        "truncate",
                        isSelected
                          ? "text-blue-700 font-medium"
                          : "text-gray-700"
                      )}
                    >
                      {node.name}
                    </span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
