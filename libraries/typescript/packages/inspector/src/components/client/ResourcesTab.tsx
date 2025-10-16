import { useInspector } from '@/client/context/InspectorContext'
import { usePrismTheme } from '@/client/hooks/usePrismTheme'
import type { Resource } from '@modelcontextprotocol/sdk/types.js'
import {
  Brush,
  Clock,
  Copy,
  Download,
  FileText,
  Maximize,
  Search,
} from 'lucide-react'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import { cn } from '@/lib/utils'
import { isMcpUIResource, McpUIRenderer } from './McpUIRenderer'

export interface ResourcesTabRef {
  focusSearch: () => void
  blurSearch: () => void
}

interface ResourcesTabProps {
  resources: Resource[]
  readResource: (uri: string) => Promise<any>
  isConnected: boolean
}

interface ResourceResult {
  uri: string
  result: any
  error?: string
  timestamp: number
}

export const ResourcesTab = forwardRef<ResourcesTabRef, ResourcesTabProps>(
  ({ resources, readResource, isConnected }, ref) => {
    const { prismStyle } = usePrismTheme()
    const [selectedResource, setSelectedResource] = useState<Resource | null>(
      null
    )
    const { selectedResourceUri, setSelectedResourceUri } = useInspector()
    const [results, setResults] = useState<ResourceResult[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [_copiedResult, _setCopiedResult] = useState<number | null>(null)
    const [searchQuery, setSearchQuery] = useState('')
    const [activeTab, setActiveTab] = useState('resources')
    const [previewMode, setPreviewMode] = useState(true)
    const [isSearchExpanded, setIsSearchExpanded] = useState(false)
    const [focusedIndex, setFocusedIndex] = useState<number>(-1)
    const searchInputRef = useRef<globalThis.HTMLInputElement>(null)

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
      if (!searchQuery) return resources
      return resources.filter(
        (resource) =>
          resource.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          resource.description
            ?.toLowerCase()
            .includes(searchQuery.toLowerCase()) ||
          resource.uri.toLowerCase().includes(searchQuery.toLowerCase())
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
          } catch (error) {
            setResults([
              {
                uri: resource.uri,
                result: null,
                error: error instanceof Error ? error.message : 'Unknown error',
                timestamp,
              },
            ])
          } finally {
            setIsLoading(false)
          }
        }
      },
      [readResource, isConnected]
    )

    // Reset focused index when filtered resources change
    useEffect(() => {
      setFocusedIndex(-1)
    }, [searchQuery, activeTab])

    // Handle keyboard navigation
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        // Check if any input is focused
        const target = e.target as HTMLElement
        const isInputFocused =
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.contentEditable === 'true'

        // Don't handle if input is focused or if modifiers are pressed
        if (isInputFocused || e.metaKey || e.ctrlKey || e.altKey) {
          return
        }

        if (activeTab !== 'resources') {
          return
        }

        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setFocusedIndex((prev) => {
            const next = prev + 1
            return next >= filteredResources.length ? 0 : next
          })
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          setFocusedIndex((prev) => {
            const next = prev - 1
            return next < 0 ? filteredResources.length - 1 : next
          })
        } else if (e.key === 'Enter' && focusedIndex >= 0) {
          e.preventDefault()
          const resource = filteredResources[focusedIndex]
          if (resource) {
            handleResourceSelect(resource)
          }
        }
      }

      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }, [focusedIndex, filteredResources, activeTab, handleResourceSelect])

    // Scroll focused item into view
    useEffect(() => {
      if (focusedIndex >= 0 && activeTab === 'resources') {
        const resource = filteredResources[focusedIndex]
        if (resource) {
          const element = document.getElementById(`resource-${resource.uri}`)
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
          }
        }
      }
    }, [focusedIndex, filteredResources, activeTab])

    // Handle auto-selection from context
    useEffect(() => {
      console.warn('[ResourcesTab] Auto-selection effect triggered:', {
        selectedResourceUri,
        resourcesCount: resources.length,
        currentSelectedResource: selectedResource?.uri,
      })

      if (selectedResourceUri && resources.length > 0) {
        const resource = resources.find((r) => r.uri === selectedResourceUri)
        console.warn('[ResourcesTab] Resource lookup result:', {
          selectedResourceUri,
          resourceFound: !!resource,
          resourceUri: resource?.uri,
          shouldSelect: resource && selectedResource?.uri !== resource.uri,
        })

        if (resource && selectedResource?.uri !== resource.uri) {
          console.warn('[ResourcesTab] Selecting resource:', resource.uri)
          // Clear the selection from context after processing
          setSelectedResourceUri(null)
          // Use setTimeout to ensure the component is fully rendered
          setTimeout(() => {
            handleResourceSelect(resource)
            // Scroll to the selected resource
            const resourceElement = document.getElementById(
              `resource-${resource.uri}`
            )
            if (resourceElement) {
              console.warn('[ResourcesTab] Scrolling to resource element')
              resourceElement.scrollIntoView({
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

    const handleCopyResult = useCallback(
      (index: number) => {
        const result = results[index]
        const resultText = result.error
          ? result.error
          : JSON.stringify(result.result, null, 2)
        navigator.clipboard.writeText(resultText)
        _setCopiedResult(index)
        setTimeout(() => _setCopiedResult(null), 2000)
      },
      [results]
    )

    const handleDownloadResult = useCallback(
      (index: number) => {
        const result = results[index]
        const resultText = result.error
          ? result.error
          : JSON.stringify(result.result, null, 2)
        const blob = new globalThis.Blob([resultText], { type: 'text/plain' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${selectedResource?.name || 'resource'}-${index}.txt`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      },
      [results, selectedResource]
    )

    const handleFullscreen = useCallback(async (index: number) => {
      try {
        if (document.fullscreenElement) {
          await document.exitFullscreen()
        } else {
          // Find the specific resource content div
          const resourceDiv = document.querySelector(
            `[data-resource-index="${index}"]`
          )
          if (resourceDiv) {
            await resourceDiv.requestFullscreen()
          }
        }
      } catch (error) {
        console.error('Failed to toggle fullscreen:', error)
      }
    }, [])

    const getResourceIcon = (mimeType?: string, uri?: string) => {
      if (uri?.startsWith('ui://')) {
        return <Brush className="h-5 w-5" />
      }
      if (!mimeType) {
        return <FileText className="h-5 w-5" />
      }
      if (mimeType.startsWith('image/')) {
        return <div className="h-5 w-5 bg-green-500 rounded" />
      }
      if (mimeType.startsWith('video/')) {
        return <div className="h-5 w-5 bg-purple-500 rounded" />
      }
      if (mimeType.startsWith('audio/')) {
        return <div className="h-5 w-5 bg-blue-500 rounded" />
      }
      if (mimeType.includes('json')) {
        return <div className="h-5 w-5 bg-yellow-500 rounded" />
      }
      if (mimeType.includes('text')) {
        return <FileText className="h-5 w-5 text-blue-500" />
      }
      return <FileText className="h-5 w-5" />
    }

    const getResourceTypeColor = (mimeType?: string, uri?: string) => {
      if (uri?.startsWith('ui://')) {
        return {
          iconColor: 'text-purple-500',
          bgColor: 'bg-purple-500/20',
          type: 'UI',
        }
      }
      if (!mimeType) {
        return {
          iconColor: 'text-gray-500',
          bgColor: 'bg-gray-500/20',
          type: 'Unknown',
        }
      }
      if (mimeType.startsWith('image/')) {
        return {
          iconColor: 'text-green-500',
          bgColor: 'bg-green-500/20',
          type: 'Image',
        }
      }
      if (mimeType.startsWith('video/')) {
        return {
          iconColor: 'text-purple-500',
          bgColor: 'bg-purple-500/20',
          type: 'Video',
        }
      }
      if (mimeType.startsWith('audio/')) {
        return {
          iconColor: 'text-blue-500',
          bgColor: 'bg-blue-500/20',
          type: 'Audio',
        }
      }
      if (mimeType.includes('json')) {
        return {
          iconColor: 'text-yellow-500',
          bgColor: 'bg-yellow-500/20',
          type: 'JSON',
        }
      }
      if (mimeType.includes('text')) {
        return {
          iconColor: 'text-blue-500',
          bgColor: 'bg-blue-500/20',
          type: 'Text',
        }
      }
      return {
        iconColor: 'text-gray-500',
        bgColor: 'bg-gray-500/20',
        type: 'File',
      }
    }

    return (
      <ResizablePanelGroup direction="horizontal" className="h-full">
        <ResizablePanel defaultSize={33}>
          <div className="flex items-center justify-between p-7 pt-5 pb-1 border-r dark:border-zinc-700">
            <div className="flex items-center gap-2 flex-1">
              {!isSearchExpanded ? (
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
                        {filteredResources.length}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setIsSearchExpanded(true)}
                        className="h-8 w-8 p-0"
                      >
                        <Search className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </>
              ) : (
                <Input
                  ref={searchInputRef}
                  placeholder="Search resources..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onBlur={handleSearchBlur}
                  className="h-8 border-gray-300 dark:border-zinc-600"
                />
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setActiveTab(
                  activeTab === 'resources' ? 'history' : 'resources'
                )
              }
              className="gap-2"
            >
              {activeTab === 'resources' ? <Clock /> : <FileText />}
              <span>{activeTab === 'resources' ? 'History' : 'Resources'}</span>
              {activeTab === 'resources' && results.length > 0 && (
                <Badge
                  className="bg-purple-500/20 text-purple-600 dark:text-purple-400 border-transparent"
                  variant="outline"
                >
                  {results.length}
                </Badge>
              )}
            </Button>
          </div>
          {/* Left pane: Resources list */}
          <div className="flex flex-col h-full border-r dark:border-zinc-700 p-4 bg-white dark:bg-black">
            <div className="flex-1 overflow-y-auto overflow-x-visible mt-6 space-y-5 p-0">
              {filteredResources.length === 0 ? (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  <p>No resources available</p>
                  <p className="text-sm">
                    Connect to a server to see resources
                  </p>
                </div>
              ) : (
                filteredResources.map((resource, index) => {
                  const typeInfo = getResourceTypeColor(
                    resource.mimeType,
                    resource.uri
                  )
                  return (
                    <div
                      key={resource.uri}
                      id={`resource-${resource.uri}`}
                      className={cn(
                        'cursor-pointer transition-all rounded-[20px] bg-zinc-100 dark:bg-white/10 hover:bg-zinc-200 dark:hover:bg-white/15 p-2',
                        selectedResource?.uri === resource.uri &&
                          'border-2 border-zinc-200 dark:border-zinc-600',
                        focusedIndex === index &&
                          'border-2 border-blue-500 dark:border-blue-400'
                      )}
                      onClick={() => handleResourceSelect(resource)}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={cn(
                            'rounded-full p-3 flex items-center justify-center',
                            typeInfo.bgColor
                          )}
                        >
                          <div className={typeInfo.iconColor}>
                            {getResourceIcon(resource.mimeType, resource.uri)}
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {resource.name}
                          </div>
                          {resource.description && (
                            <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                              {resource.description}
                            </div>
                          )}
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] font-mono text-gray-500 dark:text-gray-400 opacity-70 truncate">
                              {resource.uri}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize={67}>
          {/* Right pane: Resource details and content */}
          <div className="flex flex-col h-full bg-white dark:bg-black">
            {selectedResource ? (
              <>
                <div className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="space-x-2 flex items-center">
                        <div
                          className={cn(
                            'rounded-full p-3 flex items-center justify-center',
                            getResourceTypeColor(
                              selectedResource.mimeType,
                              selectedResource.uri
                            ).bgColor
                          )}
                        >
                          <div
                            className={
                              getResourceTypeColor(
                                selectedResource.mimeType,
                                selectedResource.uri
                              ).iconColor
                            }
                          >
                            {getResourceIcon(
                              selectedResource.mimeType,
                              selectedResource.uri
                            )}
                          </div>
                        </div>
                        <div>
                          <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {selectedResource.name}
                          </h3>
                          {selectedResource.description && (
                            <p className="text-sm text-gray-600 dark:text-gray-300">
                              {selectedResource.description}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {(results.length > 0 || isLoading) && (
                  <div className="flex-1 overflow-hidden">
                    {isLoading && (
                      <div className="flex items-center justify-center py-8">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500 mr-2" />
                        <span className="text-sm text-gray-600">
                          Loading resource...
                        </span>
                      </div>
                    )}
                    <div className="space-y-4 flex-1 h-full">
                      {results.map((result, index) => {
                        // Check if result contains MCP UI resources
                        let isMcpUI = false
                        let mcpUIResources: any[] = []

                        if (result.result) {
                          if (
                            result.result.contents &&
                            Array.isArray(result.result.contents)
                          ) {
                            // Resource response format: { contents: [...] }
                            mcpUIResources = result.result.contents.filter(
                              (item: any) =>
                                item.mimeType && isMcpUIResource(item)
                            )
                            isMcpUI = mcpUIResources.length > 0
                          } else if (result.result.mimeType) {
                            // Direct resource format
                            isMcpUI = isMcpUIResource(result.result)
                            if (isMcpUI) {
                              mcpUIResources = [result.result]
                            }
                          }
                        }

                        return (
                          <div
                            key={`result-${result.timestamp}-${result.uri}`}
                            className="space-y-0 flex-1 h-full"
                            data-resource-index={index}
                          >
                            <div
                              className={`flex items-center gap-2 px-4 pt-2 border-t border-gray-200 dark:border-zinc-600 ${
                                isMcpUI
                                  ? 'border-b border-gray-200 dark:border-zinc-600 pb-2'
                                  : ''
                              }`}
                            >
                              <h3 className="text-sm font-medium">
                                Resource Content
                              </h3>
                              <div className="flex items-center gap-1">
                                <Clock className="h-3 w-3 text-gray-400" />
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                  {new Date(
                                    result.timestamp
                                  ).toLocaleTimeString()}
                                </span>
                              </div>
                              {isMcpUI && (
                                <div className="flex items-center gap-4 ml-4">
                                  <span className="text-xs text-gray-500 dark:text-gray-400">
                                    URI: {result.uri}
                                  </span>
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => setPreviewMode(true)}
                                      className={`text-xs font-medium ${
                                        previewMode
                                          ? 'text-black dark:text-white'
                                          : 'text-zinc-500 dark:text-zinc-400'
                                      }`}
                                    >
                                      Preview
                                    </button>
                                    <span className="text-xs text-zinc-400">
                                      |
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => setPreviewMode(false)}
                                      className={`text-xs font-medium ${
                                        !previewMode
                                          ? 'text-black dark:text-white'
                                          : 'text-zinc-500 dark:text-zinc-400'
                                      }`}
                                    >
                                      JSON
                                    </button>
                                  </div>
                                </div>
                              )}
                              <div className="flex items-center gap-1 ml-auto">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleCopyResult(index)}
                                  className="h-6 w-6 p-0"
                                >
                                  <Copy className="h-3 w-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleFullscreen(index)}
                                  className="h-6 w-6 p-0"
                                >
                                  <Maximize className="h-3 w-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDownloadResult(index)}
                                  className="h-6 w-6 p-0"
                                >
                                  <Download className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>

                            {result.error ? (
                              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-3 mx-4">
                                <p className="text-red-800 dark:text-red-300 font-medium">
                                  Error:
                                </p>
                                <p className="text-red-700 dark:text-red-400 text-sm">
                                  {result.error}
                                </p>
                              </div>
                            ) : (
                              (() => {
                                if (isMcpUI) {
                                  if (previewMode) {
                                    return (
                                      <div className="space-y-0 h-full">
                                        {mcpUIResources.map(
                                          (resource: any, _idx: number) => (
                                            <div
                                              key={`mcp-ui-${
                                                resource.uri ||
                                                `resource-${Date.now()}-${Math.random()}`
                                              }`}
                                              className="mx-0 size-full"
                                            >
                                              <div className="w-full h-full">
                                                <McpUIRenderer
                                                  resource={resource}
                                                  onUIAction={(_action) => {
                                                    // Handle UI actions here if needed
                                                  }}
                                                  className="w-full h-full"
                                                />
                                              </div>
                                            </div>
                                          )
                                        )}
                                        {/* Show JSON for non-UI content */}
                                        {(() => {
                                          if (
                                            result.result.contents &&
                                            Array.isArray(
                                              result.result.contents
                                            )
                                          ) {
                                            const nonUIResources =
                                              result.result.contents.filter(
                                                (item: any) =>
                                                  !(
                                                    item.mimeType &&
                                                    isMcpUIResource(item)
                                                  )
                                              )
                                            if (nonUIResources.length > 0) {
                                              return (
                                                <div className="px-4">
                                                  <SyntaxHighlighter
                                                    language="json"
                                                    style={prismStyle}
                                                    customStyle={{
                                                      margin: 0,
                                                      padding: 0,
                                                      border: 'none',
                                                      borderRadius: 0,
                                                      fontSize: '1rem',
                                                      background: 'transparent',
                                                    }}
                                                    className="text-gray-900 dark:text-gray-100"
                                                  >
                                                    {JSON.stringify(
                                                      nonUIResources,
                                                      null,
                                                      2
                                                    )}
                                                  </SyntaxHighlighter>
                                                </div>
                                              )
                                            }
                                          }
                                          return null
                                        })()}
                                      </div>
                                    )
                                  } else {
                                    // JSON mode for MCP UI resources
                                    return (
                                      <div className="px-4 pt-4">
                                        <SyntaxHighlighter
                                          language="json"
                                          style={prismStyle}
                                          customStyle={{
                                            margin: 0,
                                            padding: 0,
                                            border: 'none',
                                            borderRadius: 0,
                                            fontSize: '1rem',
                                            background: 'transparent',
                                          }}
                                          className="text-gray-900 dark:text-gray-100"
                                        >
                                          {JSON.stringify(
                                            result.result,
                                            null,
                                            2
                                          )}
                                        </SyntaxHighlighter>
                                      </div>
                                    )
                                  }
                                }

                                // Default: show JSON for non-MCP UI resources
                                return (
                                  <div className="px-4 pt-4">
                                    <SyntaxHighlighter
                                      language="json"
                                      style={prismStyle}
                                      customStyle={{
                                        margin: 0,
                                        padding: 0,
                                        border: 'none',
                                        borderRadius: 0,
                                        fontSize: '1rem',
                                        background: 'transparent',
                                      }}
                                      className="text-gray-900 dark:text-gray-100"
                                    >
                                      {JSON.stringify(result.result, null, 2)}
                                    </SyntaxHighlighter>
                                  </div>
                                )
                              })()
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <p className="text-gray-500 dark:text-gray-400 text-lg">
                    Select a resource to get started
                  </p>
                  <p className="text-gray-400 dark:text-gray-500 text-sm">
                    Choose a resource from the list to read its content
                  </p>
                </div>
              </div>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    )
  }
)

ResourcesTab.displayName = 'ResourcesTab'
