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
import { cn } from "@/client/lib/utils";

/** Which sub-view is shown inside the Resources left panel */
export type ResourcesViewTab = "resources" | "templates";

interface ResourcesTabHeaderProps {
  activeTab: "resources";
  viewTab: ResourcesViewTab;
  isSearchExpanded: boolean;
  searchQuery: string;
  filteredResourcesCount: number;
  templatesCount: number;
  onViewTabChange: (tab: ResourcesViewTab) => void;
  onSearchExpand: () => void;
  onSearchChange: (query: string) => void;
  onSearchBlur: () => void;
  onTabSwitch: () => void;
  searchInputRef: React.RefObject<HTMLInputElement>;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export function ResourcesTabHeader({
  viewTab,
  isSearchExpanded,
  searchQuery,
  filteredResourcesCount,
  templatesCount,
  onViewTabChange,
  onSearchExpand,
  onSearchChange,
  onSearchBlur,
  searchInputRef,
  onRefresh,
  isRefreshing = false,
}: ResourcesTabHeaderProps) {
  return (
    <div className="flex flex-col border-b border-gray-200 dark:border-zinc-700">
      {/* ── Title row ──────────────────────────────────────────────────── */}
    <div className="flex flex-row items-center justify-between p-4 sm:p-4 py-3 gap-2">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {!isSearchExpanded ? (
          <>
            <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100">
              Resources
            </h2>
            {viewTab === "resources" && (
            <Badge
              className="bg-zinc-500/20 text-zinc-600 dark:text-zinc-400 border-transparent"
              variant="outline"
            >
              {filteredResourcesCount}
            </Badge>
            )}
            {viewTab === "templates" && templatesCount > 0 && (
                <Badge
                  className="bg-zinc-500/20 text-zinc-600 dark:text-zinc-400 border-transparent"
                  variant="outline"
                >
                  {templatesCount}
                </Badge>
            )}
            {viewTab === "resources" && (
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
            )}
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
            placeholder="Search resources..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onBlur={onSearchBlur}
            className="h-8 border-gray-300 dark:border-zinc-600"
          />
        )}
      </div>
    </div>

      {/* ── Sub-tab toggle: Resources | Templates ──────────────────────── */}
      {templatesCount > 0 && (
        <div className="flex px-4 pb-2 gap-1">
          <button
            type="button"
            onClick={() => onViewTabChange("resources")}
            className={cn(
              "flex-1 text-xs font-medium py-1 rounded-md transition-colors",
              viewTab === "resources"
                ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
                : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
            )}
            data-testid="resources-view-tab-resources"
          >
            Resources
          </button>
          <button
            type="button"
            onClick={() => onViewTabChange("templates")}
            className={cn(
              "flex-1 text-xs font-medium py-1 rounded-md transition-colors",
              viewTab === "templates"
                ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
                : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
            )}
            data-testid="resources-view-tab-templates"
          >
            Templates
          </button>
        </div>
      )}
    </div>
  );
}
