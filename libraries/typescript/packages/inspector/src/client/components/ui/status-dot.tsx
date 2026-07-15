import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { cn } from "@/client/lib/utils";

interface StatusDotProps {
  status: string;
  className?: string;
}

function getStatusDotClass(status: string): string {
  switch (status) {
    case "ready":
      return "bg-emerald-600 animate-status-pulse";
    case "failed":
      return "bg-rose-600 animate-status-pulse-red";
    default:
      return "bg-yellow-500 animate-status-pulse-yellow";
  }
}

function getStatusTooltip(status: string): string {
  switch (status) {
    case "ready":
      return "Connected";
    case "failed":
      return "Failed";
    default:
      return status;
  }
}

export function StatusDot({ status, className }: StatusDotProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "w-2 h-2 rounded-full shrink-0",
            getStatusDotClass(status),
            className
          )}
        />
      </TooltipTrigger>
      <TooltipContent>
        <p>{getStatusTooltip(status)}</p>
      </TooltipContent>
    </Tooltip>
  );
}
