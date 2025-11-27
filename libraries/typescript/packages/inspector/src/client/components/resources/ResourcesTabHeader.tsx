import { Search } from "lucide-react";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Kbd } from "@/client/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";

interface ResourcesTabHeaderProps {
  activeTab: "resources";
  isSearchExpanded: boolean;
  searchQuery: string;
  filteredResourcesCount: number;
  onSearchExpand: () => void;
  onSearchChange: (query: string) => void;
  onSearchBlur: () => void;
  onTabSwitch: () => void;
  searchInputRef: React.RefObject<HTMLInputElement>;
}

export function ResourcesTabHeader({
  isSearchExpanded,
  searchQuery,
  filteredResourcesCount,
  onSearchExpand,
  onSearchChange,
  onSearchBlur,
  searchInputRef,
}: ResourcesTabHeaderProps) {
  return (
    <div className="flex flex-row items-center justify-between p-4 sm:p-4 py-3 gap-2">
      <div className="flex items-center gap-2 flex-1">
        {!isSearchExpanded ? (
          <>
            <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100">
              Resources
            </h2>
            <Badge
              className="bg-zinc-500/20 text-zinc-600 dark:text-zinc-400 border-transparent"
              variant="outline"
            >
              {filteredResourcesCount}
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
  );
}
