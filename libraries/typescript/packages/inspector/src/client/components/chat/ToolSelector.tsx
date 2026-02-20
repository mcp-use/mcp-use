import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { cn } from "@/client/lib/utils";
import { Wrench } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

export interface ToolInfo {
  name: string;
  description?: string;
}

interface ToolSelectorProps {
  tools: ToolInfo[];
  disabledTools: Set<string>;
  onDisabledToolsChange: (disabledTools: Set<string>) => void;
  disabled?: boolean;
}

export function ToolSelector({
  tools,
  disabledTools,
  onDisabledToolsChange,
  disabled,
}: ToolSelectorProps) {
  const [open, setOpen] = useState(false);

  const enabledCount = tools.length - disabledTools.size;
  const allEnabled = disabledTools.size === 0;
  const someDisabled =
    disabledTools.size > 0 && disabledTools.size < tools.length;

  const toggleTool = useCallback(
    (toolName: string) => {
      const next = new Set(disabledTools);
      if (next.has(toolName)) {
        next.delete(toolName);
      } else {
        next.add(toolName);
      }
      onDisabledToolsChange(next);
    },
    [disabledTools, onDisabledToolsChange]
  );

  const toggleAll = useCallback(() => {
    if (allEnabled) {
      onDisabledToolsChange(new Set(tools.map((t) => t.name)));
    } else {
      onDisabledToolsChange(new Set());
    }
  }, [allEnabled, tools, onDisabledToolsChange]);

  const sortedTools = useMemo(
    () => [...tools].sort((a, b) => a.name.localeCompare(b.name)),
    [tools]
  );

  if (tools.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              className={cn(
                "h-auto w-auto aspect-square rounded-full p-2 relative",
                someDisabled && "text-amber-500 dark:text-amber-400"
              )}
              type="button"
              data-testid="chat-tool-selector"
            >
              <Wrench className="h-4 w-4" />
              {someDisabled && (
                <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-white leading-none">
                  {enabledCount}
                </span>
              )}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>
            Tools ({enabledCount}/{tools.length})
          </p>
        </TooltipContent>
      </Tooltip>

      <PopoverContent
        className="w-72 p-0"
        align="start"
        side="top"
        sideOffset={8}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <span className="text-xs font-medium text-muted-foreground">
            Allowed Tools ({enabledCount}/{tools.length})
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={toggleAll}
            type="button"
          >
            {allEnabled ? "Disable All" : "Enable All"}
          </Button>
        </div>
        <div className="max-h-64 overflow-y-auto py-1">
          {sortedTools.map((tool) => {
            const isEnabled = !disabledTools.has(tool.name);
            return (
              <button
                key={tool.name}
                type="button"
                className="flex items-center gap-2.5 w-full px-3 py-1.5 text-left hover:bg-accent/50 transition-colors cursor-pointer"
                onClick={() => toggleTool(tool.name)}
              >
                <Checkbox
                  checked={isEnabled}
                  className="pointer-events-none"
                  tabIndex={-1}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-mono truncate">{tool.name}</div>
                  {tool.description && (
                    <div className="text-[11px] text-muted-foreground truncate">
                      {tool.description}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
