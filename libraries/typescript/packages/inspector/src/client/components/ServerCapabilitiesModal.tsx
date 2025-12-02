import {
  CheckCircle2,
  Database,
  ExternalLink,
  Info,
  MessageSquare,
  Settings,
  XCircle,
  Zap,
} from "lucide-react";
import type { MCPConnection } from "@/client/context/McpContext";
import { Badge } from "@/client/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { JSONDisplay, IconRenderer } from "./shared";

interface ServerCapabilitiesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connection: MCPConnection | null;
}

export function ServerCapabilitiesModal({
  open,
  onOpenChange,
  connection,
}: ServerCapabilitiesModalProps) {
  if (!connection) return null;

  const capabilities = connection.capabilities || {};
  const hasCapabilities = Object.keys(capabilities).length > 0;

  const renderCapabilitySection = (
    title: string,
    icon: React.ReactNode,
    capability: any,
    fields: Array<{ key: string; label: string }>
  ) => {
    if (!capability || Object.keys(capability).length === 0) {
      return null;
    }

    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          {icon}
          <h4 className="font-semibold text-sm">{title}</h4>
        </div>
        <div className="ml-6 space-y-1.5">
          {fields.map((field) => {
            const value = capability[field.key];
            if (value === undefined) return null;

            return (
              <div key={field.key} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {field.label}:
                </span>
                {typeof value === "boolean" ? (
                  <Badge
                    variant={value ? "default" : "outline"}
                    className="text-xs"
                  >
                    {value ? (
                      <>
                        <CheckCircle2 className="w-3 h-3" />
                        Enabled
                      </>
                    ) : (
                      <>
                        <XCircle className="w-3 h-3" />
                        Disabled
                      </>
                    )}
                  </Badge>
                ) : typeof value === "object" ? (
                  <div className="flex-1 text-xs">
                    <JSONDisplay data={value} />
                  </div>
                ) : (
                  <Badge variant="outline" className="text-xs">
                    {String(value)}
                  </Badge>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const getAdditionalCapabilities = () => {
    const knownKeys = [
      "tools",
      "resources",
      "prompts",
      "logging",
      "completions",
    ];
    return Object.keys(capabilities).filter((key) => !knownKeys.includes(key));
  };

  const additionalCapabilities = getAdditionalCapabilities();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {connection.serverInfo?.icons ? (
              <IconRenderer
                icons={connection.serverInfo.icons}
                size={20}
                fallback={<Info className="w-5 h-5" />}
                className="w-5 h-5"
              />
            ) : (
              <Info className="w-5 h-5" />
            )}
            Server Capabilities
          </DialogTitle>
          <DialogDescription className="flex items-center gap-2">
            <span>
              {connection.serverInfo?.name || connection.name}
              {connection.serverInfo?.version && (
                <span className="text-muted-foreground ml-2">
                  v{connection.serverInfo.version}
                </span>
              )}
            </span>
            {connection.serverInfo?.websiteUrl && (
              <a
                href={connection.serverInfo.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="w-3 h-3" />
                <span className="text-xs">Website</span>
              </a>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {!hasCapabilities ? (
            <div className="text-center py-8 text-muted-foreground">
              <Info className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No capabilities declared by this server</p>
            </div>
          ) : (
            <>
              {renderCapabilitySection(
                "Tools",
                <Zap className="w-4 h-4" />,
                capabilities.tools,
                [{ key: "listChanged", label: "List Changed Notifications" }]
              )}

              {renderCapabilitySection(
                "Resources",
                <Database className="w-4 h-4" />,
                capabilities.resources,
                [
                  { key: "subscribe", label: "Subscription Support" },
                  { key: "listChanged", label: "List Changed Notifications" },
                ]
              )}

              {renderCapabilitySection(
                "Prompts",
                <MessageSquare className="w-4 h-4" />,
                capabilities.prompts,
                [{ key: "listChanged", label: "List Changed Notifications" }]
              )}

              {capabilities.logging && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Settings className="w-4 h-4" />
                    <h4 className="font-semibold text-sm">Logging</h4>
                  </div>
                  <div className="ml-6">
                    <JSONDisplay data={capabilities.logging} />
                  </div>
                </div>
              )}

              {capabilities.completions && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Settings className="w-4 h-4" />
                    <h4 className="font-semibold text-sm">Completions</h4>
                  </div>
                  <div className="ml-6">
                    <JSONDisplay data={capabilities.completions} />
                  </div>
                </div>
              )}

              {additionalCapabilities.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Info className="w-4 h-4" />
                    <h4 className="font-semibold text-sm">
                      Additional Capabilities
                    </h4>
                  </div>
                  <div className="ml-6 space-y-2">
                    {additionalCapabilities.map((key) => (
                      <div key={key} className="space-y-1">
                        <span className="text-xs font-medium text-muted-foreground">
                          {key}:
                        </span>
                        <div className="text-xs">
                          <JSONDisplay data={capabilities[key]} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Full capabilities JSON view */}
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
                  View Raw Capabilities JSON
                </summary>
                <div className="mt-2 p-3 bg-muted rounded-lg overflow-auto">
                  <JSONDisplay
                    data={capabilities}
                    filename={`capabilities-${connection.name}-${Date.now()}.json`}
                  />
                </div>
              </details>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
