import {
  StatusIcon,
  statusSuccessTextClassName,
} from "@/client/components/shared/StatusIcon";
import { cn } from "@/client/lib/utils";
import { ArrowUpRight, Square } from "lucide-react";

export function TunnelPopoverPanel({
  onStop,
  showCopiedBanner = false,
}: {
  onStop: () => void | Promise<void>;
  showCopiedBanner?: boolean;
}) {
  return (
    <>
      {showCopiedBanner && (
        <div
          className={cn(
            "flex items-center gap-2 text-sm -mt-1",
            statusSuccessTextClassName()
          )}
        >
          <StatusIcon state="success" />
          <span>URL copied to clipboard</span>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-sm">Tunnel URL</h4>
        <a
          href="https://manufact.com/docs/tunneling"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Docs
          <ArrowUpRight className="size-3" />
        </a>
      </div>

      <div>
        <h5 className="font-semibold text-sm mb-2">Use in ChatGPT & Claude</h5>
        <ol className="space-y-2 text-xs text-muted-foreground">
          <li className="flex gap-2">
            <span className="font-semibold text-foreground">1.</span>
            <span>
              Enable{" "}
              <a
                href="https://chatgpt.com/plugins#settings/Security"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-foreground underline underline-offset-2 hover:text-purple-600 dark:hover:text-purple-400"
              >
                dev mode
              </a>{" "}
              from settings
            </span>
          </li>
          <li className="flex gap-2">
            <span className="font-semibold text-foreground">2.</span>
            <span>
              <a
                href="https://chatgpt.com/plugins#settings/Connectors?create-connector=true&redirectAfter=%2Fplugins"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-foreground underline underline-offset-2 hover:text-purple-600 dark:hover:text-purple-400"
              >
                Add a connector
              </a>{" "}
              in App & Connectors
            </span>
          </li>
          <li className="flex gap-2">
            <span className="font-semibold text-foreground">3.</span>
            <span>Use the tunnel URL in the input</span>
          </li>
        </ol>
      </div>

      <button
        type="button"
        onClick={() => void onStop()}
        className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors cursor-pointer"
      >
        <Square className="size-3 fill-current" />
        Stop Tunnel
      </button>
    </>
  );
}
