import type { Resource } from '@modelcontextprotocol/sdk/types.js'
import type { ResourceResult } from './resources'
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/client/components/ui/resizable'
import { useInspector } from '@/client/context/InspectorContext'
import {

  ResourceResultDisplay,
  ResourcesList,
  ResourcesTabHeader,
} from './resources'

export interface ResourcesTabRef {
  focusSearch: () => void
  blurSearch: () => void
}

interface ResourcesTabProps {
  resources: Resource[]
  readResource: (uri: string) => Promise<any>
  isConnected: boolean
}

export function ResourcesTab({ ref, resources, readResource, isConnected }: ResourcesTabProps & { ref?: React.RefObject<ResourcesTabRef | null> }) {
  // State
  const [selectedResource, setSelectedResource] = useState<Resource | null>(
    null,
  )
  const { selectedResourceUri, setSelectedResourceUri } = useInspector()
  const [results, setResults] = useState<ResourceResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'resources' | 'history'>(
    'resources',
  )
  const [previewMode, setPreviewMode] = useState(true)
  const [isSearchExpanded, setIsSearchExpanded] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState<number>(-1)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const resourceDisplayRef = useRef<HTMLDivElement>(null)

  // Expose focusSearch and blurSearch methods via ref
  useImperativeHandle(ref, () => ({
    focusSearch: () => {
      setIsSearchExpanded(true)
      setTimeout(() => {
        if (searchInputRef.current) {
          searchInputRef.current.focus()
        }
      }, 0)
    },
    blurSearch: () => {
      setSearchQuery('')
      setIsSearchExpanded(false)
      if (searchInputRef.current) {
        searchInputRef.current.blur()
      }
    },
  }))

  // Auto-focus search input when expanded
  useEffect(() => {
    if (isSearchExpanded && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [isSearchExpanded])

  const handleSearchBlur = useCallback(() => {
    if (!searchQuery.trim()) {
      setIsSearchExpanded(false)
    }
  }, [searchQuery])

  const filteredResources = useMemo(() => {
    if (!searchQuery)
      return resources
    const query = searchQuery.toLowerCase()
    return resources.filter(
      resource =>
        resource.name.toLowerCase().includes(query)
        || resource.description?.toLowerCase().includes(query)
        || resource.uri.toLowerCase().includes(query),
    )
  }, [resources, searchQuery])

  const handleResourceSelect = useCallback(
    async (resource: Resource) => {
      setSelectedResource(resource)

      // Automatically read the resource when selected
      if (isConnected) {
        setIsLoading(true)
        const timestamp = Date.now()

        try {
          const result = await readResource(resource.uri)
          setResults([
            {
              uri: resource.uri,
              result,
              timestamp,
            },
          ])
        }
        catch (error) {
          setResults([
            {
              uri: resource.uri,
              result: null,
              error: error instanceof Error ? error.message : 'Unknown error',
              timestamp,
            },
          ])
        }
        finally {
          setIsLoading(false)
        }
      }
    },
    [readResource, isConnected],
  )

  // Reset focused index when filtered resources change
  useEffect(() => {
    setFocusedIndex(-1)
  }, [searchQuery, activeTab])

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const isInputFocused
        = target.tagName === 'INPUT'
          || target.tagName === 'TEXTAREA'
          || target.contentEditable === 'true'

      if (isInputFocused || e.metaKey || e.ctrlKey || e.altKey) {
        return
      }

      const items = activeTab === 'resources' ? filteredResources : results

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setFocusedIndex((prev) => {
          const next = prev + 1
          return next >= items.length ? 0 : next
        })
      }
      else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusedIndex((prev) => {
          const next = prev - 1
          return next < 0 ? items.length - 1 : next
        })
      }
      else if (e.key === 'Enter' && focusedIndex >= 0) {
        e.preventDefault()
        if (activeTab === 'resources') {
          const resource = filteredResources[focusedIndex]
          if (resource) {
            handleResourceSelect(resource)
          }
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [
    focusedIndex,
    filteredResources,
    results,
    activeTab,
    handleResourceSelect,
  ])

  // Scroll focused item into view
  useEffect(() => {
    if (focusedIndex >= 0) {
      const itemId
        = activeTab === 'resources'
          ? `resource-${filteredResources[focusedIndex]?.uri}`
          : `result-${results[focusedIndex]?.uri}`
      const element = document.getElementById(itemId)
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    }
  }, [focusedIndex, filteredResources, results, activeTab])

  // Handle auto-selection from context
  useEffect(() => {
    if (selectedResourceUri && resources.length > 0) {
      const resource = resources.find(r => r.uri === selectedResourceUri)

      if (resource && selectedResource?.uri !== resource.uri) {
        setSelectedResourceUri(null)
        setTimeout(() => {
          handleResourceSelect(resource)
          const element = document.getElementById(`resource-${resource.uri}`)
          if (element) {
            element.scrollIntoView({
              behavior: 'smooth',
              block: 'nearest',
            })
          }
        }, 100)
      }
    }
  }, [
    selectedResourceUri,
    resources,
    selectedResource,
    handleResourceSelect,
    setSelectedResourceUri,
  ])

  const currentResult = results[0] || null

  const handleCopy = useCallback(async () => {
    if (!currentResult)
      return
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(currentResult.result, null, 2),
      )
    }
    catch (error) {
      console.error('[ResourcesTab] Failed to copy result:', error)
    }
  }, [currentResult])

  const handleDownload = useCallback(() => {
    if (!currentResult)
      return
    try {
      const blob = new Blob([JSON.stringify(currentResult.result, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `resource-${Date.now()}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }
    catch (error) {
      console.error('[ResourcesTab] Failed to download result:', error)
    }
  }, [currentResult])

  const handleFullscreen = useCallback(async () => {
    if (!resourceDisplayRef.current)
      return

    try {
      if (!document.fullscreenElement) {
        await resourceDisplayRef.current.requestFullscreen()
      }
      else {
        await document.exitFullscreen()
      }
    }
    catch (error) {
      console.error('[ResourcesTab] Failed to toggle fullscreen:', error)
    }
  }, [])

  return (
    <ResizablePanelGroup direction="horizontal" className="h-full">
      <ResizablePanel defaultSize={33}>
        <ResourcesTabHeader
          activeTab={activeTab}
          isSearchExpanded={isSearchExpanded}
          searchQuery={searchQuery}
          filteredResourcesCount={filteredResources.length}
          historyCount={results.length}
          onSearchExpand={() => setIsSearchExpanded(true)}
          onSearchChange={setSearchQuery}
          onSearchBlur={handleSearchBlur}
          onTabSwitch={() =>
            setActiveTab(activeTab === 'resources' ? 'history' : 'resources')}
          searchInputRef={searchInputRef as React.RefObject<HTMLInputElement>}
        />

        <div className="flex flex-col h-full">
          {activeTab === 'resources'
            ? (
                <ResourcesList
                  resources={filteredResources}
                  selectedResource={selectedResource}
                  onResourceSelect={handleResourceSelect}
                  focusedIndex={focusedIndex}
                />
              )
            : (
                <div className="flex-1 overflow-y-auto border-r dark:border-zinc-700">
                  {results.length === 0
                    ? (
                        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                          <p>No history yet</p>
                          <p className="text-sm">Read a resource to see it here</p>
                        </div>
                      )
                    : (
                        <div className="space-y-2 p-4">
                          {results.map(result => (
                            <div
                              key={`${result.uri}-${result.timestamp}`}
                              id={`result-${result.uri}`}
                              className="p-3 bg-gray-100 dark:bg-zinc-800 rounded cursor-pointer hover:bg-gray-200 dark:hover:bg-zinc-700"
                              onClick={() => {
                                setResults([result])
                                setActiveTab('resources')
                              }}
                            >
                              <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                                {result.uri}
                              </div>
                              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                {new Date(result.timestamp).toLocaleString()}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                </div>
              )}
        </div>
      </ResizablePanel>

      <ResizableHandle />

      <ResizablePanel defaultSize={67}>
        <div ref={resourceDisplayRef} className="h-full bg-white dark:bg-zinc-900">
          <ResourceResultDisplay
            result={currentResult}
            isLoading={isLoading}
            previewMode={previewMode}
            onTogglePreview={() => setPreviewMode(!previewMode)}
            onCopy={handleCopy}
            onDownload={handleDownload}
            onFullscreen={handleFullscreen}
          />
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

ResourcesTab.displayName = 'ResourcesTab'
