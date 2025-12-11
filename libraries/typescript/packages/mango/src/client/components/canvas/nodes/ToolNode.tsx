import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Wrench } from "lucide-react";
import type { McpTool } from "../../../types.js";
import { cn } from "../../../lib/utils.js";

export interface ToolNodeData extends McpTool {
  projectName?: string;
}

/**
 * Node component for MCP tools
 */
export function ToolNode({ data, selected }: NodeProps<ToolNodeData>) {
  return (
    <div
      className={cn(
        "min-w-[200px] rounded-lg border-2 bg-card shadow-lg transition-all",
        selected ? "border-blue-500 shadow-xl" : "border-border"
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-blue-500" />

      <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-3 py-2">
        <Wrench className="h-4 w-4 text-blue-500" />
        <span className="font-semibold text-sm">Tool</span>
      </div>

      <div className="p-3 space-y-2">
        <div className="font-mono text-sm font-bold text-foreground">
          {data.name}
        </div>
        {data.description && (
          <p className="text-xs text-muted-foreground line-clamp-3">
            {data.description}
          </p>
        )}
        {data.inputSchema?.properties && (
          <div className="text-xs text-muted-foreground">
            <div className="font-semibold mb-1">Parameters:</div>
            <div className="space-y-1">
              {Object.keys(data.inputSchema.properties)
                .slice(0, 3)
                .map((param) => (
                  <div key={param} className="flex items-center gap-1">
                    <span className="font-mono text-blue-400">{param}</span>
                    {data.inputSchema.required?.includes(param) && (
                      <span className="text-red-400">*</span>
                    )}
                  </div>
                ))}
              {Object.keys(data.inputSchema.properties).length > 3 && (
                <div className="text-muted-foreground">
                  +{Object.keys(data.inputSchema.properties).length - 3} more
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!bg-blue-500"
      />
    </div>
  );
}
