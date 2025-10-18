import { Clock, FileText } from 'lucide-react'
import { ListTabHeader } from '@/client/components/shared'

interface ResourcesTabHeaderProps {
  activeTab: 'resources' | 'history'
  isSearchExpanded: boolean
  searchQuery: string
  filteredResourcesCount: number
  historyCount: number
  onSearchExpand: () => void
  onSearchChange: (query: string) => void
  onSearchBlur: () => void
  onTabSwitch: () => void
  searchInputRef: React.RefObject<HTMLInputElement>
}

export function ResourcesTabHeader({
  activeTab,
  isSearchExpanded,
  searchQuery,
  filteredResourcesCount,
  historyCount,
  onSearchExpand,
  onSearchChange,
  onSearchBlur,
  onTabSwitch,
  searchInputRef,
}: ResourcesTabHeaderProps) {
  return (
    <ListTabHeader
      activeTab={activeTab}
      isSearchExpanded={isSearchExpanded}
      searchQuery={searchQuery}
      primaryTabName="resources"
      secondaryTabName="history"
      primaryTabTitle="Resources"
      secondaryTabTitle="History"
      primaryCount={filteredResourcesCount}
      secondaryCount={historyCount}
      primaryIcon={FileText}
      secondaryIcon={Clock}
      searchPlaceholder="Search resources..."
      onSearchExpand={onSearchExpand}
      onSearchChange={onSearchChange}
      onSearchBlur={onSearchBlur}
      onTabSwitch={onTabSwitch}
      searchInputRef={searchInputRef}
    />
  )
}
