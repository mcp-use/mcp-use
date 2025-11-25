import type { ReactNode } from "react";
import { cn } from "@/client/lib/utils";

interface ListItemProps {
  /** Unique identifier for the item */
  id: string;
  /** Whether this item is selected */
  isSelected: boolean;
  /** Whether this item is focused (keyboard navigation) */
  isFocused: boolean;
  /** Icon to display */
  icon?: ReactNode;
  /** Primary title text */
  title: ReactNode;
  /** Optional description text */
  description?: string;
  /** Optional metadata to display (like badges, tags, etc.) */
  metadata?: ReactNode;
  /** Click handler */
  onClick: () => void;
  /** Optional additional class names */
  className?: string;
}

export function ListItem({
  id,
  isSelected,
  isFocused,
  icon,
  title,
  description,
  metadata,
  onClick,
  className,
}: ListItemProps) {
  return (
    <button
      id={id}
      type="button"
      onClick={onClick}
      className={cn(
        "w-full text-left cursor-pointer p-2 sm:p-4 border-b dark:border-zinc-700 hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition-colors group",
        isSelected &&
          "bg-zinc-50 dark:bg-zinc-800 border-l-4 border-l-zinc-500",
        isFocused && "ring-2 ring-zinc-500 dark:ring-zinc-400 ring-inset",
        className
      )}
    >
      <div className="flex items-start gap-2 sm:gap-3">
        {icon && <div className="flex-shrink-0 mt-1">
          <div
            className={cn(
              "p-2.5 rounded-full transition-colors",
              isSelected
                ? "bg-zinc-500 dark:bg-zinc-100/80 text-zinc-100 dark:text-zinc-900"
                : "bg-gray-100 dark:bg-zinc-700 text-gray-600 dark:text-gray-400 group-hover:bg-gray-200 dark:group-hover:bg-zinc-600"
            )}
          >
            {icon}
          </div>
        </div>}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className={cn("font-medium truncate font-mono text-sm")}>
              {title}
            </h3>
            {/* {metadata} */}
          </div>
          {description && (
            <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
              {description}
            </p>
          )}
        </div>
      </div>
    </button>
  );
}
