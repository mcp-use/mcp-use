import type { ReactNode } from "react";
import { cn } from "@/client/lib/utils";

interface ListItemProps {
  /** Unique identifier for the item */
  id: string;
  /** Whether this item is selected */
  isSelected: boolean;
  /** Whether this item is focused (keyboard navigation) */
  isFocused: boolean;
  /** Primary title text */
  title: ReactNode;
  /** Optional description text */
  description?: ReactNode;
  /** Optional metadata to display (like badges, tags, etc.) */
  metadata?: ReactNode;
  /** Click handler */
  onClick: () => void;
  /** Optional additional class names */
  className?: string;
  /** Optional data-testid for testing */
  "data-testid"?: string;
}

export function ListItem({
  id,
  isSelected,
  isFocused,
  title,
  description,
  metadata,
  onClick,
  className,
  "data-testid": dataTestId,
}: ListItemProps) {
  return (
    <button
      id={id}
      data-testid={dataTestId}
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
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className={cn("font-medium truncate font-mono text-sm")}>
              {title}
            </h3>
          </div>
          {description && (
            <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
              {description}
            </p>
          )}
        </div>
        {metadata && (
          <div className="flex-shrink-0 flex items-center self-center">
            {metadata}
          </div>
        )}
      </div>
    </button>
  );
}
