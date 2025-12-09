import { Database, Wrench } from "lucide-react";
import { ListTabHeader } from "@/client/components/shared";

interface ToolsTabHeaderProps {
  activeTab: "tools" | "saved";
  isSearchExpanded: boolean;
  searchQuery: string;
  filteredToolsCount: number;
  savedRequestsCount: number;
  onSearchExpand: () => void;
  onSearchChange: (query: string) => void;
  onSearchBlur: () => void;
  onTabSwitch: () => void;
  searchInputRef: React.RefObject<HTMLInputElement>;
  onRefresh?: () => void | Promise<void>;
  isRefreshing?: boolean;
}

export function ToolsTabHeader({
  activeTab,
  isSearchExpanded,
  searchQuery,
  filteredToolsCount,
  savedRequestsCount,
  onSearchExpand,
  onSearchChange,
  onSearchBlur,
  onTabSwitch,
  searchInputRef,
  onRefresh,
  isRefreshing,
}: ToolsTabHeaderProps) {
  return (
    <ListTabHeader
      activeTab={activeTab}
      isSearchExpanded={isSearchExpanded}
      searchQuery={searchQuery}
      primaryTabName="tools"
      secondaryTabName="saved"
      primaryTabTitle="Tools"
      secondaryTabTitle="Saved"
      primaryCount={filteredToolsCount}
      secondaryCount={savedRequestsCount}
      primaryIcon={Wrench}
      secondaryIcon={Database}
      searchPlaceholder="Search tools..."
      onSearchExpand={onSearchExpand}
      onSearchChange={onSearchChange}
      onSearchBlur={onSearchBlur}
      onTabSwitch={onTabSwitch}
      searchInputRef={searchInputRef}
      onRefresh={onRefresh}
      isRefreshing={isRefreshing}
    />
  );
}
