import { Button } from "@/client/components/ui/button";
import { Card, CardContent } from "@/client/components/ui/card";
import {
  Activity,
  CheckCircle2,
  Database,
  Info,
  Loader2,
  Server,
  Trash2,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import type { MCPConnection } from "../../client/context/McpContext";
import { useMcpContext } from "../../client/context/McpContext";
import { ServerCapabilitiesModal } from "./ServerCapabilitiesModal";
import { ServerIcon } from "./ServerIcon";

export function ServerList() {
  const { connections, removeConnection } = useMcpContext();
  const [capabilitiesModalOpen, setCapabilitiesModalOpen] = useState(false);
  const [selectedConnection, setSelectedConnection] =
    useState<MCPConnection | null>(null);

  const handleOpenCapabilities = (connection: MCPConnection) => {
    setSelectedConnection(connection);
    setCapabilitiesModalOpen(true);
  };

  const handleDeleteConnection = (id: string) => {
    removeConnection(id);
  };

  const getStatusColor = (state: string) => {
    switch (state) {
      case "ready":
        return "text-green-600 bg-green-50";
      case "failed":
        return "text-red-600 bg-red-50";
      case "connecting":
      case "discovering":
      case "loading":
      case "authenticating":
        return "text-yellow-600 bg-yellow-50";
      default:
        return "text-gray-500 bg-gray-50";
    }
  };

  const getStatusIcon = (state: string) => {
    switch (state) {
      case "ready":
        return <CheckCircle2 className="w-3 h-3 mr-1" />;
      case "connecting":
      case "discovering":
      case "loading":
      case "authenticating":
        return <Loader2 className="w-3 h-3 mr-1 animate-spin" />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">MCP Servers</h2>
        <p className="text-muted-foreground">
          Manage and inspect your MCP server connections
        </p>
      </div>

      {connections.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Server className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No servers found</h3>
            <p className="text-muted-foreground text-center mb-4">
              You haven't connected to any MCP servers yet.
            </p>
            <Button asChild>
              <Link to="/">Add your first server</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {connections.map((connection) => (
            <Card key={connection.id}>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <ServerIcon
                      serverUrl={connection.url}
                      serverName={connection.name}
                      serverIcon={connection.serverInfo?.icon}
                      size="lg"
                    />
                    <div className="space-y-1">
                      <h3 className="font-semibold text-lg">
                        {connection.name}
                      </h3>
                      <div className="flex items-center space-x-4 text-sm text-muted-foreground">
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-medium flex items-center ${getStatusColor(
                            connection.state
                          )}`}
                        >
                          {getStatusIcon(connection.state)}
                          {connection.state}
                        </span>
                        {connection.state === "ready" && (
                          <>
                            <div className="flex items-center space-x-1">
                              <Zap className="w-4 h-4" />
                              <span>{connection.tools.length} tools</span>
                            </div>
                            <div className="flex items-center space-x-1">
                              <Database className="w-4 h-4" />
                              <span>
                                {connection.resources.length} resources
                              </span>
                            </div>
                            <div className="flex items-center space-x-1">
                              <Activity className="w-4 h-4" />
                              <span>{connection.prompts.length} prompts</span>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    {connection.state === "ready" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleOpenCapabilities(connection)}
                        title="View server capabilities"
                      >
                        <Info className="w-4 h-4" />
                      </Button>
                    )}
                    <Button asChild variant="outline" size="sm">
                      <Link
                        to={`/?server=${encodeURIComponent(connection.id)}`}
                      >
                        Inspect
                      </Link>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDeleteConnection(connection.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ServerCapabilitiesModal
        open={capabilitiesModalOpen}
        onOpenChange={setCapabilitiesModalOpen}
        connection={selectedConnection}
      />
    </div>
  );
}
