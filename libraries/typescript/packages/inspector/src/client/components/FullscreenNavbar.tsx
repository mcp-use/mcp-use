import { X } from "lucide-react";
import { cn } from "@/client/lib/utils";

interface FullscreenNavbarProps {
  title: string;
  onClose: () => void;
  className?: string;
}

export function FullscreenNavbar({
  title,
  onClose,
  className,
}: FullscreenNavbarProps) {
  return (
    <div
      className={cn(
        "fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-3",
        "bg-background/80 backdrop-blur-md border-b border-border",
        "supports-[backdrop-filter]:bg-background/60",
        className
      )}
    >
      {/* Left: Branding */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-foreground/80">
          MCP Inspector
        </span>
      </div>

      {/* Center: Widget Title */}
      <div className="flex-1 text-center">
        <h2 className="text-sm font-medium text-foreground truncate max-w-md mx-auto">
          {title}
        </h2>
      </div>

      {/* Right: Close Button */}
      <div className="flex items-center">
        <button
          onClick={onClose}
          className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-md",
            "text-sm font-medium",
            "bg-background/50 hover:bg-background/80",
            "border border-border hover:border-border/80",
            "transition-colors",
            "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          )}
          aria-label="Exit Fullscreen"
        >
          <X className="w-4 h-4" />
          <span className="hidden sm:inline">Exit Fullscreen</span>
        </button>
      </div>
    </div>
  );
}

