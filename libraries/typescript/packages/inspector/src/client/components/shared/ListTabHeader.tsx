import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import type { LucideIcon } from "lucide-react";
import { RefreshCw, Search } from "lucide-react";
import {
  inspectorStickyTabHeaderClass,
  inspectorTabHeaderPadding,
  inspectorTabTitleClass,
} from "@/client/lib/font-weight";
import { Kbd } from "../ui/kbd";

export const tabHeaderIconClass = "h-3.5 w-3.5 shrink-0 text-muted-foreground";

interface ListTabHeaderProps {
  /** Current active tab name */
  activeTab: string;
  /** Whether the search input is expanded */
  isSearchExpanded: boolean;
  /** Current search query */
  searchQuery: string;
  /** Title to display for the primary tab */
  primaryTabTitle: string;
  /** Title to display for the secondary tab */
  secondaryTabTitle: string;
  /** Count of items in the primary tab */
  primaryCount: number;
  /** Count of items in the secondary tab */
  secondaryCount: number;
  /** Icon for the secondary tab button */
  secondaryIcon: LucideIcon;
  /** Icon for the primary tab button */
  primaryIcon: LucideIcon;
  /** Placeholder text for the search input */
  searchPlaceholder?: string;
  /** Callback when search is expanded */
  onSearchExpand: () => void;
  /** Callback when search query changes */
  onSearchChange: (query: string) => void;
  /** Callback when search input is blurred */
  onSearchBlur: () => void;
  /** Callback when tab is switched */
  onTabSwitch: () => void;
  /** Ref for the search input */
  searchInputRef: React.RefObject<HTMLInputElement>;
  /** Name of the primary tab (for comparison) */
  primaryTabName: string;
  /** Name of the secondary tab (for comparison) */
  secondaryTabName: string;
  /** Callback when refresh is requested */
  onRefresh?: () => void;
  /** Whether a refresh is in progress */
  isRefreshing?: boolean;
  /** Whether the parent scroll area has been scrolled */
  isScrolled?: boolean;
}

export function ListTabHeader({
  activeTab,
  isSearchExpanded,
  searchQuery,
  primaryTabTitle,
  secondaryTabTitle,
  primaryCount,
  secondaryCount,
  secondaryIcon: SecondaryIcon,
  primaryIcon: PrimaryIcon,
  searchPlaceholder = "Search...",
  onSearchExpand,
  onSearchChange,
  onSearchBlur,
  onTabSwitch,
  searchInputRef,
  primaryTabName,
  onRefresh,
  isRefreshing = false,
  isScrolled = false,
}: ListTabHeaderProps) {
  const isPrimaryTab = activeTab === primaryTabName;
  const ActiveIcon = isPrimaryTab ? PrimaryIcon : SecondaryIcon;
  const activeTitle = isPrimaryTab ? primaryTabTitle : secondaryTabTitle;

  return (
    <div
      className={`flex flex-row items-center justify-between gap-2 ${inspectorStickyTabHeaderClass(isScrolled)} ${inspectorTabHeaderPadding}`}
    >
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {!isSearchExpanded ? (
          <>
            <h2
              className={`${inspectorTabTitleClass} flex items-center gap-1.5`}
            >
              <ActiveIcon className={tabHeaderIconClass} aria-hidden />
              {activeTitle}
            </h2>
            {isPrimaryTab && (
              <>
                <Badge
                  className="bg-zinc-500/20 text-zinc-600 dark:text-zinc-400 border-transparent"
                  variant="outline"
                >
                  {primaryCount}
                </Badge>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={onSearchExpand}
                        className="h-8 w-8 p-0"
                      >
                        <Search className="h-4 w-4" />
                      </Button>
                    }
                    nativeButton
                  />
                  <TooltipContent side="bottom" className="flex gap-2">
                    Search
                    <Kbd>F</Kbd>
                  </TooltipContent>
                </Tooltip>
                {onRefresh && (
                  <Tooltip>
                    <TooltipTrigger
                      render={
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
                      }
                      nativeButton
                    />
                    <TooltipContent side="bottom" className="flex gap-2">
                      Refresh list
                      <Kbd>R</Kbd>
                    </TooltipContent>
                  </Tooltip>
                )}
              </>
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
      <Button
        variant="ghost"
        size="sm"
        onClick={onTabSwitch}
        className="gap-2 flex-shrink-0"
      >
        <span className="hidden sm:inline">
          {isPrimaryTab ? secondaryTabTitle : primaryTabTitle}
        </span>
        {isPrimaryTab && secondaryCount > 0 && (
          <Badge
            className="bg-purple-500/20 text-purple-600 dark:text-purple-400 border-transparent"
            variant="outline"
          >
            {secondaryCount}
          </Badge>
        )}
      </Button>
    </div>
  );
}
