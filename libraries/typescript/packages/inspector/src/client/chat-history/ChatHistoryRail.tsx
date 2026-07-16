import { Button } from "@/client/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { ArrowLeftFromLine } from "lucide-react";

/** Collapse control on the drawer edge — only shown when history is open. */
export function ChatHistoryRail({ onCollapse }: { onCollapse: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            tabIndex={-1}
            aria-label="Collapse"
            onClick={onCollapse}
            className="border-border absolute top-1/2 right-0 z-30 size-7 min-h-7 min-w-7 -translate-y-1/2 translate-x-1/2 rounded-full border bg-background"
          >
            <ArrowLeftFromLine className="size-4" />
            <span className="sr-only">Collapse</span>
          </Button>
        }
        nativeButton
      />
      <TooltipContent side="right">
        Collapse
      </TooltipContent>
    </Tooltip>
  );
}
