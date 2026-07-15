import { Button } from "@/client/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { cn } from "@/client/lib/utils";
import { copyToClipboard } from "@/client/utils/browser";
import { Check, Copy, Globe } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

function formatUrlChipLabel(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname + u.search;
    return u.hostname + (path && path !== "/" ? path : "");
  } catch {
    return url;
  }
}

interface ServerUrlChipProps {
  url: string;
  className?: string;
}

export function ServerUrlChip({ url, className }: ServerUrlChipProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!url) return null;

  const chipLabel = formatUrlChipLabel(url);

  const handleCopy = async () => {
    try {
      await copyToClipboard(url);
      setCopied(true);
      toast.success("URL copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy URL");
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "text-blue-500 hover:underline flex items-center gap-1 min-w-0 truncate text-left text-sm",
            className
          )}
        >
          <Globe className="size-3.5 shrink-0" />
          <span className="truncate max-w-[min(24rem,30vw)]">{chipLabel}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="start" sideOffset={4}>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-3 flex items-center gap-1.5"
          onClick={handleCopy}
        >
          {copied ? (
            <Check className="size-3.5 shrink-0" />
          ) : (
            <Copy className="size-3.5 shrink-0" />
          )}
          <span>Copy URL</span>
        </Button>
      </PopoverContent>
    </Popover>
  );
}
