import { Button } from "@/client/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { cn } from "@/client/lib/utils";
import { PanelLeft } from "lucide-react";

export function SidebarRail({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            tabIndex={-1}
            aria-label={label}
            onClick={onToggle}
            className={cn(
              "border-border absolute top-1/2 right-0 z-30 hidden size-7 min-h-7 min-w-7 -translate-y-1/2 translate-x-1/2 rounded-full border bg-background lg:flex",
              "opacity-0 transition-opacity duration-200 group-hover/sidebar:opacity-100 focus-visible:opacity-100"
            )}
          >
            <PanelLeft className="size-4" />
            <span className="sr-only">{label}</span>
          </Button>
        }
        nativeButton
      />
      <TooltipContent side="right" align="center">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
