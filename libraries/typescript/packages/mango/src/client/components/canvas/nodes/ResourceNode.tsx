import { Handle, Position, type NodeProps } from "@xyflow/react";
import { FileText } from "lucide-react";
import type { McpResource } from "../../../types.js";
import { cn } from "../../../lib/utils.js";

export interface ResourceNodeData extends McpResource {
  projectName?: string;
}

/**
 * Node component for MCP resources
 */
export function ResourceNode({ data, selected }: NodeProps<ResourceNodeData>) {
  return (
    <div
      className={cn(
        "min-w-[200px] rounded-lg border-2 bg-card shadow-lg transition-all",
        selected ? "border-green-500 shadow-xl" : "border-border"
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-green-500"
      />

      <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-3 py-2">
        <FileText className="h-4 w-4 text-green-500" />
        <span className="font-semibold text-sm">Resource</span>
      </div>

      <div className="p-3 space-y-2">
        <div className="font-mono text-sm font-bold text-foreground">
          {data.name || data.uri}
        </div>
        {data.description && (
          <p className="text-xs text-muted-foreground line-clamp-3">
            {data.description}
          </p>
        )}
        <div className="flex flex-wrap gap-2 text-xs">
          {data.mimeType && (
            <span className="rounded bg-green-500/10 px-2 py-0.5 font-mono text-green-600 dark:text-green-400">
              {data.mimeType}
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground font-mono truncate">
          {data.uri}
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!bg-green-500"
      />
    </div>
  );
}
