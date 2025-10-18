import { Database, Search, Wrench } from 'lucide-react'
import { Badge } from '@/client/components/ui/badge'
import { Button } from '@/client/components/ui/button'
import { Input } from '@/client/components/ui/input'

interface ToolsTabHeaderProps {
  activeTab: 'tools' | 'saved'
  isSearchExpanded: boolean
  searchQuery: string
  filteredToolsCount: number
  savedRequestsCount: number
  onSearchExpand: () => void
  onSearchChange: (query: string) => void
  onSearchBlur: () => void
  onTabSwitch: () => void
  searchInputRef: React.RefObject<HTMLInputElement>
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
}: ToolsTabHeaderProps) {
  return (
    <div className="flex items-center justify-between p-6 py-3 border-r dark:border-zinc-700">
      <div className="flex items-center gap-2 flex-1">
        {!isSearchExpanded
          ? (
              <>
                <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100">
                  {activeTab === 'tools' ? 'Tools' : 'Saved Requests'}
                </h2>
                {activeTab === 'tools' && (
                  <>
                    <Badge
                      className="bg-blue-500/20 text-blue-600 dark:text-blue-400 border-transparent"
                      variant="outline"
                    >
                      {filteredToolsCount}
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
                placeholder="Search tools..."
                value={searchQuery}
                onChange={e => onSearchChange(e.target.value)}
                onBlur={onSearchBlur}
                className="h-8 border-gray-300 dark:border-zinc-600"
              />
            )}
      </div>
      <Button variant="ghost" size="sm" onClick={onTabSwitch} className="gap-2">
        {activeTab === 'tools' ? <Database /> : <Wrench />}
        <span>{activeTab === 'tools' ? 'Saved' : 'Tools'}</span>
        {activeTab === 'tools' && savedRequestsCount > 0 && (
          <Badge
            className="bg-purple-500/20 text-purple-600 dark:text-purple-400 border-transparent"
            variant="outline"
          >
            {savedRequestsCount}
          </Badge>
        )}
      </Button>
    </div>
  )
}
