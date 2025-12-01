import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { Wrench } from "lucide-react";
import { ListItem, IconRenderer } from "@/client/components/shared";
import { Badge } from "@/client/components/ui/badge";

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

  return (
    <div className="overflow-y-auto flex-1 overscroll-contain">
      {tools.map((tool, index) => {
        // Use icon from tool.icons if available, otherwise fallback to Wrench
        const toolIcons = (tool as any).icons;
        const icon = toolIcons ? (
          <IconRenderer
            icons={toolIcons}
            size={16}
            fallback={<Wrench className="h-4 w-4" />}
            className="h-4 w-4"
          />
        ) : (
          <Wrench className="h-4 w-4" />
        );

        return (
          <ListItem
            key={tool.name}
            id={`tool-${tool.name}`}
            isSelected={selectedTool?.name === tool.name}
            isFocused={focusedIndex === index}
            icon={icon}
            title={tool.name}
            description={tool.description}
            metadata={
              tool.inputSchema?.properties && (
                <Badge
                  variant="outline"
                  className="text-xs border-gray-300 dark:border-zinc-600 text-gray-600 dark:text-gray-400"
                >
                  {Object.keys(tool.inputSchema.properties).length} params
                </Badge>
              )
            }
            onClick={() => onToolSelect(tool)}
          />
        );
      })}
    </div>
  );
}
