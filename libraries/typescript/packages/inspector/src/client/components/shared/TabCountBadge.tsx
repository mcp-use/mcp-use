import { cn } from "@/client/lib/utils";

interface TabCountBadgeProps {
  count: number;
  isActive: boolean;
  /** `sm` for mobile header tabs; `md` for desktop */
  size?: "sm" | "md";
}

export function TabCountBadge({
  count,
  isActive,
  size = "md",
}: TabCountBadgeProps) {
  if (count <= 0) {
    return null;
  }

  return (
    <span
      className={cn(
        isActive ? "dark:bg-black" : "dark:bg-zinc-700",
        "shrink-0 ml-1 bg-zinc-200 text-zinc-700 dark:text-zinc-300 rounded-full font-medium",
        size === "sm" && "text-[10px] px-1.5 py-0.5",
        size === "md" && "text-xs px-2 py-0.5"
      )}
    >
      {count}
    </span>
  );
}
