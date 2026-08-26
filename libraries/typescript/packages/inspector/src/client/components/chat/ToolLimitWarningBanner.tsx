import { AlertCircle } from "lucide-react";
import { getToolLimitWarning } from "./tool-limit-warning";

interface ToolLimitWarningBannerProps {
  provider?: string | null;
  toolCount: number;
}

export function ToolLimitWarningBanner({
  provider,
  toolCount,
}: ToolLimitWarningBannerProps) {
  const warning = getToolLimitWarning(provider, toolCount);
  if (!warning) return null;

  return (
    <div className="mb-2 flex w-full items-center justify-center px-2 sm:px-4">
      <div
        role="alert"
        className="flex w-full max-w-3xl items-start gap-3 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-100"
      >
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="font-medium">Tool limit exceeded</div>
          <div className="text-xs opacity-90">
            This server has {warning.toolCount} tools, but this model supports
            up to {warning.limit}. Exceeding this limit may cause unexpected
            model behavior due to context constraints.
          </div>
        </div>
      </div>
    </div>
  );
}
