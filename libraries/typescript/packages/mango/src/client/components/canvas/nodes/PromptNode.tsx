import { Handle, Position, type NodeProps } from "@xyflow/react";
import { MessageSquare } from "lucide-react";
import type { McpPrompt } from "../../../types.js";
import { cn } from "../../../lib/utils.js";

export interface PromptNodeData extends McpPrompt {
  projectName?: string;
}

/**
 * Node component for MCP prompts
 */
export function PromptNode({ data, selected }: NodeProps<PromptNodeData>) {
  return (
    <div
      className={cn(
        "min-w-[200px] rounded-lg border-2 bg-card shadow-lg transition-all",
        selected ? "border-purple-500 shadow-xl" : "border-border"
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-purple-500"
      />

      <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-3 py-2">
        <MessageSquare className="h-4 w-4 text-purple-500" />
        <span className="font-semibold text-sm">Prompt</span>
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
        {data.arguments && data.arguments.length > 0 && (
          <div className="text-xs text-muted-foreground">
            <div className="font-semibold mb-1">Arguments:</div>
            <div className="space-y-1">
              {data.arguments.slice(0, 3).map((arg) => (
                <div key={arg.name} className="flex items-center gap-1">
                  <span className="font-mono text-purple-400">{arg.name}</span>
                  {arg.required && <span className="text-red-400">*</span>}
                </div>
              ))}
              {data.arguments.length > 3 && (
                <div className="text-muted-foreground">
                  +{data.arguments.length - 3} more
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!bg-purple-500"
      />
    </div>
  );
}
