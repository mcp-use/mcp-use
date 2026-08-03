import { cn } from "@/client/lib/utils";
import { ChevronsLeftRightEllipsis, Loader2 } from "lucide-react";

export function TunnelStartButton({
  devFromCli,
  isTunnelStarting,
  onStart,
}: {
  devFromCli: boolean | null;
  isTunnelStarting: boolean;
  onStart: () => void | Promise<void>;
}) {
  if (isTunnelStarting) {
    return (
      <button
        disabled
        className="flex items-center gap-1 h-6 px-2 bg-violet-50 dark:bg-violet-950/40 border border-violet-200 dark:border-violet-800 rounded-full opacity-75 cursor-wait shrink-0"
      >
        <Loader2 className="size-3 text-violet-500 dark:text-violet-400 animate-spin" />
        <span className="text-xs font-medium text-violet-600 dark:text-violet-300 hidden lg:inline">
          Start Tunnel
        </span>
      </button>
    );
  }

  const canStart = devFromCli === true;
  const loadingDev = devFromCli === null;

  return (
    <button
      type="button"
      onClick={() => void onStart()}
      disabled={!canStart || loadingDev}
      title={
        devFromCli === false
          ? "Run `mcp-use dev` from your project to enable tunneling."
          : loadingDev
            ? "Checking dev server…"
            : undefined
      }
      className={cn(
        "flex items-center gap-1 h-6 px-2 border rounded-full transition-colors shrink-0",
        canStart && !loadingDev
          ? "bg-violet-50 dark:bg-violet-950/40 border-violet-200 dark:border-violet-800 hover:bg-violet-100 dark:hover:bg-violet-900/50 cursor-pointer"
          : "bg-violet-50/60 dark:bg-violet-950/20 border-violet-200 dark:border-violet-800 cursor-not-allowed opacity-70"
      )}
    >
      {loadingDev ? (
        <Loader2 className="size-3 text-violet-500 dark:text-violet-400 animate-spin" />
      ) : (
        <ChevronsLeftRightEllipsis className="size-3 text-violet-500 dark:text-violet-400" />
      )}
      <span className="text-xs font-medium text-violet-600 dark:text-violet-300 hidden lg:inline">
        Start Tunnel
      </span>
    </button>
  );
}
