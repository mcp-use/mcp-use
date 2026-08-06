import { cn } from "@/client/lib/utils";
import { AlertTriangle, Check, Loader2, XCircle } from "lucide-react";

/** Circle badge tones — aligned with MCP Use Cloud build log step icons. */
const STATUS_ICON_TONE = {
  success:
    "border-emerald-700/20 bg-emerald-700/10 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-400",
  failed:
    "border-red-500/20 bg-red-500/10 text-red-500 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-400",
  warning:
    "border-amber-700/20 bg-amber-700/10 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-400",
  loading:
    "border-purple-500/20 bg-purple-500/10 text-purple-500 dark:border-purple-400/30 dark:bg-purple-400/10 dark:text-purple-400 animate-spin",
} as const;

const CIRCLE_ICON = "size-4 shrink-0 rounded-full border p-0.5";

type StatusIconState = "success" | "failed" | "warning" | "loading";

/**
 * Reusable status glyph (build logs drawer style): emerald check, red X,
 * amber warning, purple spinner.
 */
export function StatusIcon({
  state,
  className,
}: {
  state: StatusIconState;
  className?: string;
}) {
  const cls = cn(CIRCLE_ICON, STATUS_ICON_TONE[state], className);

  switch (state) {
    case "success":
      return <Check className={cls} aria-hidden />;
    case "failed":
      return <XCircle className={cls} aria-hidden />;
    case "warning":
      return <AlertTriangle className={cls} aria-hidden />;
    case "loading":
      return <Loader2 className={cls} aria-hidden />;
    default:
      return null;
  }
}

/** Text color matching {@link StatusIcon} success tone. */
export function statusSuccessTextClassName(): string {
  return "text-emerald-700 dark:text-emerald-400";
}
