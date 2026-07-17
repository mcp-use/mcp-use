import { cn } from "@/client/lib/utils";

interface TabCountBadgeProps {
  count: number;
  isActive: boolean;
  /** `sm` for mobile header tabs; `md` for desktop */
  size?: "sm" | "md";
  /** Pin to bottom-right of a relative icon wrapper (mobile tab bar). */
  overlay?: boolean;
}

export function TabCountBadge({
  count,
  isActive,
  size = "md",
  overlay = false,
}: TabCountBadgeProps) {
  if (count <= 0) {
    return null;
  }

  return (
    <span
      className={cn(
        isActive ? "dark:bg-black" : "dark:bg-zinc-700",
        "shrink-0 bg-zinc-200 text-zinc-700 dark:text-zinc-300 rounded-full font-medium",
        overlay &&
          "absolute -bottom-1 -right-1.5 z-10 flex h-3.5 min-w-3.5 items-center justify-center border border-background px-0.5 text-[9px] leading-none",
        !overlay && "ml-1",
        !overlay && size === "sm" && "text-[10px] px-1.5 py-0.5",
        !overlay && size === "md" && "text-xs px-2 py-0.5"
      )}
    >
      {count}
    </span>
  );
}
