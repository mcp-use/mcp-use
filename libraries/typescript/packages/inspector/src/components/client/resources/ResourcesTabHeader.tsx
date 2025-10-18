import { Clock, FileText, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

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
    <div className="flex items-center justify-between p-7 pt-5 pb-1 border-r dark:border-zinc-700">
      <div className="flex items-center gap-2 flex-1">
        {!isSearchExpanded
          ? (
              <>
                <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100">
                  {activeTab === 'resources' ? 'Resources' : 'History'}
                </h2>
                {activeTab === 'resources' && (
                  <>
                    <Badge
                      className="bg-blue-500/20 text-blue-600 dark:text-blue-400 border-transparent"
                      variant="outline"
                    >
                      {filteredResourcesCount}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={onSearchExpand}
                      className="h-8 w-8 p-0"
                    >
                      <Search className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </>
            )
          : (
              <Input
                ref={searchInputRef}
                placeholder="Search resources..."
                value={searchQuery}
                onChange={e => onSearchChange(e.target.value)}
                onBlur={onSearchBlur}
                className="h-8 border-gray-300 dark:border-zinc-600"
              />
            )}
      </div>
      <Button variant="ghost" size="sm" onClick={onTabSwitch} className="gap-2">
        {activeTab === 'resources' ? <Clock /> : <FileText />}
        <span>{activeTab === 'resources' ? 'History' : 'Resources'}</span>
        {activeTab === 'resources' && historyCount > 0 && (
          <Badge
            className="bg-purple-500/20 text-purple-600 dark:text-purple-400 border-transparent"
            variant="outline"
          >
            {historyCount}
          </Badge>
        )}
      </Button>
    </div>
  )
}
