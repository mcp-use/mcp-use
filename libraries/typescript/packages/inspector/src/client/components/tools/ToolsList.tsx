import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { Wrench } from "lucide-react";
import { ListItem } from "@/client/components/shared";
import { McpIcon, OpenAIIcon } from "@/client/components/ui/client-icons";
import { Badge } from "@/client/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { detectWidgetProtocol } from "@/client/utils/widget-detection";

interface ToolsListProps {
  tools: Tool[];
  selectedTool: Tool | null;
  onToolSelect: (tool: Tool) => void;
  focusedIndex: number;
}

export function ToolsList({
  tools,
  selectedTool,
  onToolSelect,
  focusedIndex,
}: ToolsListProps) {
  if (tools.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center">
        <Wrench className="h-12 w-12 text-gray-400 dark:text-gray-600 mb-3" />
        <p className="text-gray-500 dark:text-gray-400">No tools available</p>
      </div>
    );
  }

  const atLeastOneToolHasParams = tools.some(
    (t) =>
      t.inputSchema?.properties &&
      Object.keys(t.inputSchema.properties).length > 0
  );

  return (
    <div className="overflow-y-auto flex-1 overscroll-contain">
      {tools.map((tool, index) => {
        const toolMeta = (tool as { _meta?: Record<string, unknown> })._meta;
        const protocol = detectWidgetProtocol(
          toolMeta as Record<string, unknown> | undefined,
          undefined
        );
        const properties = tool.inputSchema?.properties;
        const paramCount = properties ? Object.keys(properties).length : 0;
        const paramsBadge = atLeastOneToolHasParams && paramCount > 0 && (
          <Badge
            variant="outline"
            className="text-xs border-gray-300 dark:border-zinc-600 text-gray-600 dark:text-gray-400"
          >
            {paramCount} params
          </Badge>
        );
        const hasWidgetIcons =
          protocol === "mcp-apps" ||
          protocol === "chatgpt-app" ||
          protocol === "both";
        const metadata =
          hasWidgetIcons || paramsBadge ? (
            <div className="flex items-center gap-1.5">
              {(protocol === "mcp-apps" || protocol === "both") && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <McpIcon className="h-3.5 w-3.5" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>MCP-APP</p>
                  </TooltipContent>
                </Tooltip>
              )}
              {(protocol === "chatgpt-app" || protocol === "both") && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <OpenAIIcon className="h-3.5 w-3.5" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Apps SDK</p>
                  </TooltipContent>
                </Tooltip>
              )}
              {paramsBadge}
            </div>
          ) : undefined;

        return (
          <ListItem
            key={tool.name}
            id={`tool-${tool.name}`}
            data-testid={`tool-item-${tool.name}`}
            isSelected={selectedTool?.name === tool.name}
            isFocused={focusedIndex === index}
            icon={<Wrench className="h-4 w-4" />}
            title={tool.name}
            description={tool.description}
            metadata={metadata}
            onClick={() => onToolSelect(tool)}
          />
        );
      })}
    </div>
  );
}
