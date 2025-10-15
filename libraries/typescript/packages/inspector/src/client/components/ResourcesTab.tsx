import type { Resource } from '@modelcontextprotocol/sdk/types.js'
import { Copy, Download, FileText, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { usePrismTheme } from '@/client/hooks/usePrismTheme'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { isMcpUIResource, McpUIRenderer } from './McpUIRenderer'

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

export function ResourcesTab({ resources, readResource, isConnected }: ResourcesTabProps) {
  const { prismStyle } = usePrismTheme()
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null)
  const [results, setResults] = useState<ResourceResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [_copiedResult, _setCopiedResult] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState('resources')
  const [previewMode, setPreviewMode] = useState(true)
  const searchInputRef = useRef<globalThis.HTMLInputElement>(null)

  // Auto-focus the search input when the component mounts
  useEffect(() => {
    if (searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [])

  const handleResourceSelect = useCallback(async (resource: Resource) => {
    setSelectedResource(resource)

    // Automatically read the resource when selected
    if (isConnected) {
      setIsLoading(true)
      const timestamp = Date.now()

      try {
        const result = await readResource(resource.uri)
        setResults(prev => [{
          uri: resource.uri,
          result,
          timestamp,
        }, ...prev])
      }
      catch (error) {
        setResults(prev => [{
          uri: resource.uri,
          result: null,
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp,
        }, ...prev])
      }
      finally {
        setIsLoading(false)
      }
    }
  }, [readResource, isConnected])

  // Handle auto-selection from command palette
  useEffect(() => {
    const selectedResourceName = sessionStorage.getItem('selected-resources')
    if (selectedResourceName && resources.length > 0) {
      const resource = resources.find(r => r.name === selectedResourceName)
      if (resource) {
        handleResourceSelect(resource)
        sessionStorage.removeItem('selected-resources')
      }
    }
  }, [resources, handleResourceSelect])

  const handleCopyResult = useCallback((index: number) => {
    const result = results[index]
    const resultText = result.error ? result.error : JSON.stringify(result.result, null, 2)
    navigator.clipboard.writeText(resultText)
    _setCopiedResult(index)
    setTimeout(() => _setCopiedResult(null), 2000)
  }, [results])

  const handleDownloadResult = useCallback((index: number) => {
    const result = results[index]
    const resultText = result.error ? result.error : JSON.stringify(result.result, null, 2)
    const blob = new globalThis.Blob([resultText], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${selectedResource?.name || 'resource'}-${index}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [results, selectedResource])

  const filteredResources = useMemo(() => {
    if (!searchQuery)
      return resources
    return resources.filter(resource =>
      resource.name.toLowerCase().includes(searchQuery.toLowerCase())
      || resource.description?.toLowerCase().includes(searchQuery.toLowerCase())
      || resource.uri.toLowerCase().includes(searchQuery.toLowerCase()),
    )
  }, [resources, searchQuery])

  const getResourceIcon = (mimeType?: string) => {
    if (!mimeType)
      return <FileText className="h-4 w-4" />

    if (mimeType.startsWith('image/')) {
      return <div className="h-4 w-4 bg-green-500 rounded" />
    }
    if (mimeType.startsWith('video/')) {
      return <div className="h-4 w-4 bg-purple-500 rounded" />
    }
    if (mimeType.startsWith('audio/')) {
      return <div className="h-4 w-4 bg-blue-500 rounded" />
    }
    if (mimeType.includes('json')) {
      return <div className="h-4 w-4 bg-yellow-500 rounded" />
    }
    if (mimeType.includes('text')) {
      return <FileText className="h-4 w-4 text-blue-500" />
    }

    return <FileText className="h-4 w-4" />
  }

  const getResourceType = (mimeType?: string) => {
    if (!mimeType)
      return 'Unknown'
    return mimeType.split('/')[0].charAt(0).toUpperCase() + mimeType.split('/')[0].slice(1)
  }

  return (
    <ResizablePanelGroup direction="horizontal" className="h-full">
      <ResizablePanel defaultSize={33}>
        {/* Left pane: Resources list with search */}
        <div className="flex flex-col h-full border-r dark:border-zinc-700 p-6 bg-white dark:bg-zinc-800">
          <div className="p-0 ">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-2 bg-zinc-100 dark:bg-zinc-700 rounded-full">
                <TabsTrigger value="resources">
                  Resources
                  <Badge className="ml-2" variant="outline">{filteredResources.length}</Badge>
                </TabsTrigger>
                <TabsTrigger value="saved">Saved Requests</TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="mt-4 relative">
              <Search className="absolute left-3 top-1/2 border-none transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                ref={searchInputRef}
                placeholder="Search resources by name, description, or URI"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-10 bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-all border-none rounded-full"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto overflow-x-visible mt-6 space-y-5 p-2">
            {filteredResources.length === 0
              ? (
                  <div className="text-center py-8 text-gray-500">
                    <FileText className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                    <p className="text-lg font-medium">No resources found</p>
                    <p className="text-sm">
                      {searchQuery ? 'Try adjusting your search terms' : 'This server has no resources available'}
                    </p>
                  </div>
                )
              : (
                  filteredResources.map(resource => (
                    <Card
                      key={resource.uri}
                      className={cn(
                        'cursor-pointer transition-all hover:shadow-md',
                        selectedResource?.uri === resource.uri && 'ring-2 ring-blue-500 shadow-md',
                      )}
                      onClick={() => handleResourceSelect(resource)}
                    >
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              {getResourceIcon(resource.mimeType)}
                              <CardTitle className="text-base font-medium truncate">
                                {resource.name}
                              </CardTitle>
                            </div>
                            <CardDescription className="text-sm text-gray-600 mt-1 line-clamp-2">
                              {resource.description || 'No description available'}
                            </CardDescription>
                            <div className="flex items-center gap-2 mt-2">
                              <Badge variant="secondary" className="text-xs">
                                {getResourceType(resource.mimeType)}
                              </Badge>
                              <span className="text-xs text-gray-500 truncate">
                                {resource.uri}
                              </span>
                            </div>
                          </div>
                        </div>
                      </CardHeader>
                    </Card>
                  ))
                )}
          </div>
        </div>
      </ResizablePanel>

      <ResizableHandle withHandle />

      <ResizablePanel defaultSize={67}>
        {/* Right pane: Resource details and content */}
        <div className="flex flex-col h-full bg-white dark:bg-zinc-800 p-6">
          {selectedResource
            ? (
                <>
                  <div className="mb-6">
                    <div className="flex items-center gap-2 mb-2">
                      {getResourceIcon(selectedResource.mimeType)}
                      <h3 className="text-lg font-semibold">{selectedResource.name}</h3>
                    </div>
                    <p className="text-sm text-gray-600 mb-2">
                      {selectedResource.description
                        || 'No description available'}
                    </p>
                    <div className="flex items-center gap-2 mb-4">
                      <Badge variant="secondary" className="text-xs">
                        {getResourceType(selectedResource.mimeType)}
                      </Badge>
                      <span className="text-xs text-gray-500">
                        {selectedResource.uri}
                      </span>
                    </div>

                    {/* Show MCP UI resource directly if it's available */}
                    {isMcpUIResource(selectedResource) && (selectedResource.text || selectedResource.blob)
                      ? (
                          <div className="border rounded-lg overflow-hidden mb-4">
                            <div className="bg-gray-100 dark:bg-zinc-700 px-3 py-2 text-xs text-gray-600 dark:text-zinc-300 border-b dark:border-zinc-600">
                              <span className="font-medium">MCP UI Resource Preview</span>
                            </div>
                            <McpUIRenderer
                              resource={selectedResource}
                              onUIAction={(_action) => {
                                // Handle UI actions here if needed
                              }}
                              className="p-4"
                            />
                          </div>
                        )
                      : null}
                  </div>

                  {(results.length > 0 || isLoading) && (
                    <div className="flex-1 overflow-hidden">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-sm font-medium text-gray-700">Content</h4>
                        {(() => {
                          // Check if any result contains MCP UI resources
                          const hasMcpUIResources = results.some((result) => {
                            if (!result.result)
                              return false

                            // Handle different resource data structures
                            if (result.result.contents && Array.isArray(result.result.contents)) {
                              // Resource response format: { contents: [...] }
                              return result.result.contents.some((item: any) =>
                                item.mimeType && isMcpUIResource(item),
                              )
                            }
                            else if (result.result.mimeType) {
                              // Direct resource format
                              return isMcpUIResource(result.result)
                            }
                            return false
                          })

                          if (hasMcpUIResources) {
                            return (
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => setPreviewMode(true)}
                                  className={`text-xs font-medium ${
                                    previewMode
                                      ? 'text-black dark:text-white'
                                      : 'text-zinc-500 dark:text-zinc-400'
                                  }`}
                                >
                                  Preview
                                </button>
                                <span className="text-xs text-zinc-400">|</span>
                                <button
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
                            )
                          }
                          return null
                        })()}
                      </div>
                      {isLoading && (
                        <div className="flex items-center justify-center py-8">
                          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500 mr-2" />
                          <span className="text-sm text-gray-600">Loading resource...</span>
                        </div>
                      )}
                      <div className="space-y-3 overflow-y-auto max-h-96">
                        {results.map((result, index) => {
                          // Check if result contains MCP UI resources
                          let isMcpUI = false
                          let mcpUIResources: any[] = []

                          if (result.result) {
                            if (result.result.contents && Array.isArray(result.result.contents)) {
                              // Resource response format: { contents: [...] }
                              mcpUIResources = result.result.contents.filter((item: any) =>
                                item.mimeType && isMcpUIResource(item),
                              )
                              isMcpUI = mcpUIResources.length > 0
                            }
                            else if (result.result.mimeType) {
                              // Direct resource format
                              isMcpUI = isMcpUIResource(result.result)
                              if (isMcpUI) {
                                mcpUIResources = [result.result]
                              }
                            }
                          }

                          return (
                            <div key={index} className="border dark:border-zinc-700 rounded-lg p-3 bg-gray-50 dark:bg-zinc-700">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-medium text-gray-700">
                                  {result.uri}
                                </span>
                                <div className="flex items-center gap-1">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => handleCopyResult(index)}
                                    className="h-6 w-6 p-0"
                                  >
                                    <Copy className="h-3 w-3" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => handleDownloadResult(index)}
                                    className="h-6 w-6 p-0"
                                  >
                                    <Download className="h-3 w-3" />
                                  </Button>
                                </div>
                              </div>
                              <div className="text-xs text-gray-500 mb-2">
                                {new Date(result.timestamp).toLocaleString()}
                              </div>
                              {result.error
                                ? (
                                    <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-2 rounded">
                                      {result.error}
                                    </div>
                                  )
                                : (() => {
                                    if (isMcpUI) {
                                      if (previewMode) {
                                        return (
                                          <div className="space-y-0 h-full">
                                            {mcpUIResources.map((resource: any, idx: number) => (
                                              <div key={idx} className="mx-0 size-full">
                                                <div className="w-full h-full">
                                                  <div className="border rounded-lg overflow-hidden">
                                                    <div className="bg-gray-100 dark:bg-zinc-700 px-3 py-2 text-xs text-gray-600 dark:text-zinc-300 border-b dark:border-zinc-600">
                                                      <span className="font-medium">MCP UI Resource</span>
                                                    </div>
                                                    <McpUIRenderer
                                                      resource={resource}
                                                      onUIAction={(_action) => {
                                                        // Handle UI actions here if needed
                                                      }}
                                                      className="p-4"
                                                    />
                                                  </div>
                                                </div>
                                              </div>
                                            ))}
                                            {/* Show JSON for non-UI content */}
                                            {(() => {
                                              if (result.result.contents && Array.isArray(result.result.contents)) {
                                                const nonUIResources = result.result.contents.filter((item: any) =>
                                                  !(item.mimeType && isMcpUIResource(item)),
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
                                                        {JSON.stringify(nonUIResources, null, 2)}
                                                      </SyntaxHighlighter>
                                                    </div>
                                                  )
                                                }
                                              }
                                              return null
                                            })()}
                                          </div>
                                        )
                                      }
                                      else {
                                        // JSON mode for MCP UI resources
                                        return (
                                          <div className="max-h-64 overflow-y-auto">
                                            <SyntaxHighlighter
                                              language="json"
                                              style={prismStyle}
                                              className="text-xs rounded"
                                              customStyle={{
                                                margin: 0,
                                                background: 'transparent',
                                              }}
                                            >
                                              {JSON.stringify(result.result, null, 2)}
                                            </SyntaxHighlighter>
                                          </div>
                                        )
                                      }
                                    }

                                    // Default: show JSON for non-MCP UI resources
                                    return (
                                      <div className="max-h-64 overflow-y-auto">
                                        <SyntaxHighlighter
                                          language="json"
                                          style={prismStyle}
                                          className="text-xs rounded"
                                          customStyle={{
                                            margin: 0,
                                            background: 'transparent',
                                          }}
                                        >
                                          {JSON.stringify(result.result, null, 2)}
                                        </SyntaxHighlighter>
                                      </div>
                                    )
                                  })()}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </>
              )
            : (
                <div className="flex-1 flex items-center justify-center text-gray-500">
                  <div className="text-center">
                    <FileText className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                    <p className="text-lg font-medium">Select a resource</p>
                    <p className="text-sm">Choose a resource from the list to see details and read its content</p>
                  </div>
                </div>
              )}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
