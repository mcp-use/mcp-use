import { cn } from "@/client/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { ChevronLeft, ChevronRight } from "lucide-react";

export function CollapseButton({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onToggle}
          className={cn(
            "shrink-0 p-1.5 rounded-md transition-all duration-500 ease-in-out cursor-pointer",
            "text-muted-foreground hover:text-foreground",
            "hover:bg-zinc-100 dark:hover:bg-zinc-800",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          )}
          aria-label={collapsed ? "Expand tabs" : "Collapse tabs"}
          type="button"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4 transition-transform duration-500 ease-in-out" />
          ) : (
            <ChevronLeft className="h-4 w-4 transition-transform duration-500 ease-in-out" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{collapsed ? "Expand tabs" : "Collapse tabs"}</p>
      </TooltipContent>
    </Tooltip>
  );
}
