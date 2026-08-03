import { cn } from "@/client/lib/utils";

/** Frosted pill for chat header controls — chat scrolls underneath the absolute header. */
export const chatBarFrostedPill =
  "rounded-full bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60 dark:bg-zinc-950/75 dark:supports-[backdrop-filter]:bg-zinc-950/55";

/** Title pill: no extra padding so text stays aligned with other tab headers. */
export const chatBarTitleFrostedClass = cn(chatBarFrostedPill, "w-fit");

export const chatBarActionButtonClass = cn(
  chatBarFrostedPill,
  "h-9 gap-1.5 px-3"
);
