import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { StatusIcon } from "@/client/components/shared/StatusIcon";
import { cn } from "@/client/lib/utils";
import { copyToClipboard } from "@/client/utils/browser";
import { ChevronsLeftRightEllipsis, Copy, Globe } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { TunnelPopoverPanel } from "./TunnelPopoverPanel";

function formatUrlChipLabel(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname + u.search;
    return u.host + (path && path !== "/" ? path : "");
  } catch {
    return url;
  }
}

interface ServerUrlChipTunnelPopover {
  mcpUrl: string;
  onStop: () => void | Promise<void>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  autoCopyOnOpen?: boolean;
}

interface ServerUrlChipProps {
  url: string;
  className?: string;
  tunnelPopover?: ServerUrlChipTunnelPopover;
}

function UrlCopyButton({
  copied,
  onCopy,
  className,
}: {
  copied: boolean;
  onCopy: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onCopy();
      }}
      aria-label={copied ? "URL copied" : "Copy URL"}
      className={cn(
        "shrink-0 cursor-pointer p-0.5 rounded-sm text-muted-foreground hover:text-foreground transition-opacity opacity-0 group-hover:opacity-100",
        className
      )}
    >
      {copied ? (
        <StatusIcon state="success" className="size-3.5" />
      ) : (
        <Copy className="size-3.5" />
      )}
    </button>
  );
}

export function ServerUrlChip({
  url,
  className,
  tunnelPopover,
}: ServerUrlChipProps) {
  const [copied, setCopied] = useState(false);
  const [showCopiedBanner, setShowCopiedBanner] = useState(false);
  const [displayUrl, setDisplayUrl] = useState(url);
  const [previousUrl, setPreviousUrl] = useState<string | null>(null);
  const [isUrlTransitioning, setIsUrlTransitioning] = useState(false);

  useEffect(() => {
    if (!url || url === displayUrl) return;

    setPreviousUrl(displayUrl);
    setDisplayUrl(url);
    setIsUrlTransitioning(true);

    const id = window.setTimeout(() => {
      setPreviousUrl(null);
      setIsUrlTransitioning(false);
    }, 280);
    return () => window.clearTimeout(id);
  }, [displayUrl, url]);

  const chipLabel = formatUrlChipLabel(url);
  const displayChipLabel = formatUrlChipLabel(displayUrl);
  const previousChipLabel = previousUrl
    ? formatUrlChipLabel(previousUrl)
    : null;
  const copyTarget = tunnelPopover?.mcpUrl ?? url;
  const isTunnel = !!tunnelPopover;

  const handleCopy = async () => {
    try {
      await copyToClipboard(copyTarget);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy URL");
    }
  };

  useEffect(() => {
    if (!tunnelPopover?.autoCopyOnOpen) {
      setShowCopiedBanner(false);
      return;
    }
    setShowCopiedBanner(true);
    setCopied(true);
    const id = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(id);
  }, [tunnelPopover?.autoCopyOnOpen]);

  if (!url) return null;

  const urlLabel = (
    <>
      {isTunnel ? (
        <ChevronsLeftRightEllipsis className="size-3.5 shrink-0" />
      ) : (
        <Globe className="size-3.5 shrink-0" />
      )}
      <span
        className="inspector-url-transition min-w-0 max-w-[min(24rem,30vw)]"
        aria-hidden="true"
      >
        {previousChipLabel && isUrlTransitioning && (
          <span className="inspector-url-transition-out">
            {previousChipLabel}
          </span>
        )}
        <span
          className={cn(
            "inspector-url-transition-in",
            !isUrlTransitioning && "inspector-url-transition-static"
          )}
        >
          {displayChipLabel}
        </span>
      </span>
    </>
  );

  const urlClasses = cn(
    "flex items-center gap-1 min-w-0 truncate text-left text-sm cursor-pointer",
    isTunnel ? "text-purple-600 dark:text-purple-400" : "text-blue-500"
  );

  return (
    <div className={cn("group flex items-center gap-1.5 min-w-0", className)}>
      {isTunnel ? (
        <Popover
          open={tunnelPopover.open}
          onOpenChange={tunnelPopover.onOpenChange}
        >
          <PopoverTrigger
            render={
              <button
                type="button"
                aria-label={chipLabel}
                className={cn(urlClasses, "hover:opacity-80")}
              >
                {urlLabel}
              </button>
            }
            nativeButton
          />
          <PopoverContent
            className="w-[calc(100vw-2rem)] sm:w-96"
            align="start"
            sideOffset={4}
          >
            <TunnelPopoverPanel
              showCopiedBanner={showCopiedBanner}
              onStop={async () => {
                tunnelPopover.onOpenChange(false);
                await tunnelPopover.onStop();
              }}
            />
          </PopoverContent>
        </Popover>
      ) : (
        <span className={urlClasses}>{urlLabel}</span>
      )}

      <UrlCopyButton copied={copied} onCopy={() => void handleCopy()} />
    </div>
  );
}
