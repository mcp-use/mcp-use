import { useCallback, useEffect, useState } from "react";
import type { McpConnection, McpPrimitives } from "../types.js";

export interface UseMcpConnection {
  connection: McpConnection | null;
  primitives: McpPrimitives | null;
  isLoading: boolean;
  error: string | null;
  connect: (projectName: string, url: string) => Promise<void>;
  disconnect: () => Promise<void>;
  refreshPrimitives: () => Promise<void>;
}

/**
 * Hook for managing MCP connection state
 */
export function useMcpConnection(): UseMcpConnection {
  const [connection, setConnection] = useState<McpConnection | null>(null);
  const [primitives, setPrimitives] = useState<McpPrimitives | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async (projectName: string, url: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/mcp/connect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ projectName, url }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to connect");
      }

      const data = await response.json();

      setConnection({
        projectName,
        url,
        connected: true,
      });

      // Fetch primitives after connecting
      await fetchPrimitives(projectName);
    } catch (err: any) {
      setError(err.message);
      console.error("Connection error:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    if (!connection) return;

    try {
      await fetch(`/api/mcp/${connection.projectName}`, {
        method: "DELETE",
      });

      setConnection(null);
      setPrimitives(null);
    } catch (err: any) {
      console.error("Disconnect error:", err);
    }
  }, [connection]);

  const fetchPrimitives = async (projectName: string) => {
    try {
      const response = await fetch(`/api/mcp/${projectName}/primitives`);

      if (!response.ok) {
        throw new Error("Failed to fetch primitives");
      }

      const data = await response.json();

      setPrimitives({
        tools: data.tools || [],
        resources: data.resources || [],
        prompts: data.prompts || [],
      });

      // Update connection with primitives
      setConnection((prev) =>
        prev
          ? {
              ...prev,
              primitives: {
                tools: data.tools || [],
                resources: data.resources || [],
                prompts: data.prompts || [],
              },
            }
          : null
      );
    } catch (err: any) {
      console.error("Fetch primitives error:", err);
      setError(err.message);
    }
  };

  const refreshPrimitives = useCallback(async () => {
    if (!connection) return;
    await fetchPrimitives(connection.projectName);
  }, [connection]);

  return {
    connection,
    primitives,
    isLoading,
    error,
    connect,
    disconnect,
    refreshPrimitives,
  };
}
