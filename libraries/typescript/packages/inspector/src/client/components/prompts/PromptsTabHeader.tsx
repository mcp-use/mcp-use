import { Clock, MessageSquare } from "lucide-react";
import { ListTabHeader } from "@/client/components/shared";

interface PromptsTabHeaderProps {
  activeTab: "prompts" | "saved";
  isSearchExpanded: boolean;
  searchQuery: string;
  filteredPromptsCount: number;
  savedPromptsCount: number;
  onSearchExpand: () => void;
  onSearchChange: (query: string) => void;
  onSearchBlur: () => void;
  onTabSwitch: () => void;
  searchInputRef: React.RefObject<HTMLInputElement>;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export function PromptsTabHeader({
  activeTab,
  isSearchExpanded,
  searchQuery,
  filteredPromptsCount,
  savedPromptsCount,
  onSearchExpand,
  onSearchChange,
  onSearchBlur,
  onTabSwitch,
  searchInputRef,
  onRefresh,
  isRefreshing,
}: PromptsTabHeaderProps) {
  return (
    <ListTabHeader
      activeTab={activeTab}
      isSearchExpanded={isSearchExpanded}
      searchQuery={searchQuery}
      primaryTabName="prompts"
      secondaryTabName="saved"
      primaryTabTitle="Prompts"
      secondaryTabTitle="History"
      primaryCount={filteredPromptsCount}
      secondaryCount={savedPromptsCount}
      primaryIcon={MessageSquare}
      secondaryIcon={Clock}
      searchPlaceholder="Search prompts..."
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
