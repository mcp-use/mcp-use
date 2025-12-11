import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Sparkles } from "lucide-react";
import type { McpResource } from "../../../types.js";
import { cn } from "../../../lib/utils.js";

export interface WidgetNodeData extends McpResource {
  projectName?: string;
  isWidget: boolean;
}

/**
 * Check if resource is a widget (MCP UI or OpenAI Apps SDK)
 */
export function isWidgetResource(resource: McpResource): boolean {
  const mimeType = resource.mimeType?.toLowerCase() || "";
  return (
    mimeType === "text/html" ||
    mimeType === "text/html+skybridge" ||
    mimeType.startsWith("application/vnd.mcp-ui") ||
    resource.uri?.includes("/widget/") ||
    false
  );
}

/**
 * Node component for widget resources
 */
export function WidgetNode({ data, selected }: NodeProps<WidgetNodeData>) {
  return (
    <div
      className={cn(
        "min-w-[200px] rounded-lg border-2 bg-card shadow-lg transition-all",
        selected ? "border-orange-500 shadow-xl" : "border-border"
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-orange-500"
      />

      <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-3 py-2">
        <Sparkles className="h-4 w-4 text-orange-500" />
        <span className="font-semibold text-sm">Widget</span>
      </div>

      <div className="p-3 space-y-2">
        <div className="font-mono text-sm font-bold text-foreground">
          {data.name || "Widget Resource"}
        </div>
        {data.description && (
          <p className="text-xs text-muted-foreground line-clamp-3">
            {data.description}
          </p>
        )}
        <div className="flex flex-wrap gap-2 text-xs">
          {data.mimeType && (
            <span className="rounded bg-orange-500/10 px-2 py-0.5 font-mono text-orange-600 dark:text-orange-400">
              {data.mimeType}
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          Interactive UI component
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!bg-orange-500"
      />
    </div>
  );
}
