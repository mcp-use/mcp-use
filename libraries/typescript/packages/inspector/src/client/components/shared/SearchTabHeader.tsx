import type { LucideIcon } from "lucide-react";
import { RefreshCw, Search } from "lucide-react";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Kbd } from "@/client/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";

interface BulkAction {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

interface SearchTabHeaderProps {
  title: string;
  count: number;
  isSearchExpanded: boolean;
  searchQuery: string;
  searchPlaceholder: string;
  onSearchExpand: () => void;
  onSearchChange: (query: string) => void;
  onSearchBlur: () => void;
  searchInputRef: React.RefObject<HTMLInputElement>;
  titleTestId?: string;
  bulkAction?: BulkAction;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export function SearchTabHeader({
  title,
  count,
  isSearchExpanded,
  searchQuery,
  searchPlaceholder,
  onSearchExpand,
  onSearchChange,
  onSearchBlur,
  searchInputRef,
  titleTestId,
  bulkAction,
  onRefresh,
  isRefreshing = false,
}: SearchTabHeaderProps) {
  const BulkIcon = bulkAction?.icon;

  return (
    <div className="flex flex-row items-center justify-between p-4 sm:p-4 py-3 gap-2">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {!isSearchExpanded ? (
          <>
            <h2
              className="text-lg font-medium text-gray-900 dark:text-gray-100"
              data-testid={titleTestId}
            >
              {title}
            </h2>
            <Badge
              className="bg-zinc-500/20 text-zinc-600 dark:text-zinc-400 border-transparent"
              variant="outline"
            >
              {count}
            </Badge>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onSearchExpand}
                  className="h-8 w-8 p-0"
                >
                  <Search className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="flex gap-2">
                Search
                <Kbd>F</Kbd>
              </TooltipContent>
            </Tooltip>
            {onRefresh && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onRefresh}
                    disabled={isRefreshing}
                    className="h-8 w-8 p-0"
                  >
                    <RefreshCw
                      className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="flex gap-2">
                  Refresh list
                  <Kbd>R</Kbd>
                </TooltipContent>
              </Tooltip>
            )}
          </>
        ) : (
          <Input
            ref={searchInputRef}
            placeholder={searchPlaceholder}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onBlur={onSearchBlur}
            className="h-8 border-gray-300 dark:border-zinc-600"
          />
        )}
      </div>
      {bulkAction && BulkIcon && (
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={bulkAction.onClick}
                disabled={bulkAction.disabled}
                className="h-8 w-8 p-0"
              >
                <BulkIcon className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{bulkAction.label}</TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  );
}
