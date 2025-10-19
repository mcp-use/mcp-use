import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import type { SavedRequest, ToolResult } from './tools'
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
  SavedRequestsList,
  SaveRequestDialog,
  ToolExecutionPanel,
  ToolResultDisplay,
  ToolsList,
  ToolsTabHeader,
} from './tools'

export interface ToolsTabRef {
  focusSearch: () => void
  blurSearch: () => void
}

interface ToolsTabProps {
  tools: Tool[]
  callTool: (name: string, args?: Record<string, unknown>) => Promise<any>
  isConnected: boolean
}

const SAVED_REQUESTS_KEY = 'mcp-inspector-saved-requests'

export function ToolsTab({
  ref,
  tools,
  callTool,
  isConnected,
}: ToolsTabProps & { ref?: React.RefObject<ToolsTabRef | null> }) {
  // State
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null)
  const { selectedToolName, setSelectedToolName } = useInspector()
  const [toolArgs, setToolArgs] = useState<Record<string, unknown>>({})
  const [results, setResults] = useState<ToolResult[]>([])
  const [isExecuting, setIsExecuting] = useState(false)
  const [copiedResult, setCopiedResult] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'tools' | 'saved'>('tools')
  const [savedRequests, setSavedRequests] = useState<SavedRequest[]>([])
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [requestName, setRequestName] = useState('')
  const [previewMode, setPreviewMode] = useState(true)
  const [isSearchExpanded, setIsSearchExpanded] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState<number>(-1)
  const searchInputRef = useRef<HTMLInputElement | null>(null)

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

  // Load saved requests from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SAVED_REQUESTS_KEY)
      if (saved) {
        setSavedRequests(JSON.parse(saved))
      }
    } catch (error) {
      console.error('[ToolsTab] Failed to load saved requests:', error)
    }
  }, [])

  // Save to localStorage whenever savedRequests changes
  const saveSavedRequests = useCallback((requests: SavedRequest[]) => {
    try {
      localStorage.setItem(SAVED_REQUESTS_KEY, JSON.stringify(requests))
      setSavedRequests(requests)
    } catch (error) {
      console.error('[ToolsTab] Failed to save requests:', error)
    }
  }, [])

  // Filter tools based on search query
  const filteredTools = useMemo(() => {
    if (!searchQuery.trim()) return tools

    const query = searchQuery.toLowerCase()
    return tools.filter(
      (tool) =>
        tool.name.toLowerCase().includes(query) ||
        tool.description?.toLowerCase().includes(query)
    )
  }, [tools, searchQuery])

  const handleToolSelect = useCallback((tool: Tool) => {
    setSelectedTool(tool)
    // Initialize args with default values based on tool input schema
    const initialArgs: Record<string, unknown> = {}
    if (tool.inputSchema?.properties) {
      Object.entries(tool.inputSchema.properties).forEach(([key, prop]) => {
        const typedProp = prop as any
        if (typedProp.default !== undefined) {
          initialArgs[key] = typedProp.default
        } else if (typedProp.type === 'string') {
          initialArgs[key] = ''
        } else if (typedProp.type === 'number') {
          initialArgs[key] = 0
        } else if (typedProp.type === 'boolean') {
          initialArgs[key] = false
        } else if (typedProp.type === 'array') {
          initialArgs[key] = []
        } else if (typedProp.type === 'object') {
          initialArgs[key] = {}
        }
      })
    }
    setToolArgs(initialArgs)
  }, [])

  const loadSavedRequest = useCallback(
    (request: SavedRequest) => {
      const tool = tools.find((t) => t.name === request.toolName)
      if (tool) {
        setSelectedTool(tool)
        setToolArgs(request.args)
      }
    },
    [tools]
  )

  // Auto-focus the search input when expanded
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

  // Collapse search when switching away from tools tab
  useEffect(() => {
    if (activeTab !== 'tools') {
      setIsSearchExpanded(false)
    }
  }, [activeTab])

  // Reset focused index when filtered tools change
  useEffect(() => {
    setFocusedIndex(-1)
  }, [searchQuery, activeTab])

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement
      const isInputFocused =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.contentEditable === 'true'

      if (isInputFocused || e.metaKey || e.ctrlKey || e.altKey) {
        return
      }

      const items = activeTab === 'tools' ? filteredTools : savedRequests

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setFocusedIndex((prev) => {
          const next = prev + 1
          return next >= items.length ? 0 : next
        })
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusedIndex((prev) => {
          const next = prev - 1
          return next < 0 ? items.length - 1 : next
        })
      } else if (e.key === 'Enter' && focusedIndex >= 0) {
        e.preventDefault()
        if (activeTab === 'tools') {
          const tool = filteredTools[focusedIndex]
          if (tool) {
            handleToolSelect(tool)
          }
        } else {
          const request = savedRequests[focusedIndex]
          if (request) {
            loadSavedRequest(request)
          }
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [
    focusedIndex,
    filteredTools,
    savedRequests,
    activeTab,
    handleToolSelect,
    loadSavedRequest,
  ])

  // Scroll focused item into view
  useEffect(() => {
    if (focusedIndex >= 0) {
      const itemId =
        activeTab === 'tools'
          ? `tool-${filteredTools[focusedIndex]?.name}`
          : `saved-${savedRequests[focusedIndex]?.id}`
      const element = document.getElementById(itemId)
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    }
  }, [focusedIndex, filteredTools, savedRequests, activeTab])

  // Handle auto-selection from context
  useEffect(() => {
    if (selectedToolName && tools.length > 0) {
      const tool = tools.find((t) => t.name === selectedToolName)

      if (tool && selectedTool?.name !== tool.name) {
        setSelectedToolName(null)
        setTimeout(() => {
          handleToolSelect(tool)
          const toolElement = document.getElementById(`tool-${tool.name}`)
          if (toolElement) {
            toolElement.scrollIntoView({
              behavior: 'smooth',
              block: 'nearest',
            })
          }
        }, 100)
      }
    }
  }, [
    selectedToolName,
    tools,
    selectedTool,
    handleToolSelect,
    setSelectedToolName,
  ])

  const handleArgChange = useCallback(
    (key: string, value: string) => {
      setToolArgs((prev) => {
        const newArgs = { ...prev }

        if (selectedTool?.inputSchema?.properties?.[key]) {
          const prop = selectedTool.inputSchema.properties[key] as any
          const expectedType = prop.type

          if (expectedType === 'string') {
            newArgs[key] = value
          } else {
            try {
              newArgs[key] = JSON.parse(value)
            } catch {
              newArgs[key] = value
            }
          }
        } else {
          try {
            newArgs[key] = JSON.parse(value)
          } catch {
            newArgs[key] = value
          }
        }

        return newArgs
      })
    },
    [selectedTool]
  )

  const executeTool = useCallback(async () => {
    if (!selectedTool || isExecuting) return

    setIsExecuting(true)
    const startTime = Date.now()

    try {
      const result = await callTool(selectedTool.name, toolArgs)
      const duration = Date.now() - startTime

      setResults((prev) => [
        {
          toolName: selectedTool.name,
          args: toolArgs,
          result,
          timestamp: startTime,
          duration,
        },
        ...prev,
      ])
    } catch (error) {
      setResults((prev) => [
        {
          toolName: selectedTool.name,
          args: toolArgs,
          result: null,
          error: error instanceof Error ? error.message : String(error),
          timestamp: startTime,
          duration: Date.now() - startTime,
        },
        ...prev,
      ])
    } finally {
      setIsExecuting(false)
    }
  }, [selectedTool, toolArgs, isExecuting, callTool])

  const handleCopyResult = useCallback(async (index: number, result: any) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(result, null, 2))
      setCopiedResult(index)
      setTimeout(() => setCopiedResult(null), 2000)
    } catch (error) {
      console.error('[ToolsTab] Failed to copy result:', error)
    }
  }, [])

  const handleDeleteResult = useCallback((index: number) => {
    setResults((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleFullscreen = useCallback(
    (index: number) => {
      const result = results[index]
      if (result) {
        const newWindow = window.open('', '_blank', 'width=800,height=600')
        if (newWindow) {
          newWindow.document.write(`
            <html>
              <head>
                <title>${result.toolName} Result</title>
                <style>
                  body { font-family: monospace; padding: 20px; background: #1e1e1e; color: #d4d4d4; }
                  pre { white-space: pre-wrap; word-wrap: break-word; }
                </style>
              </head>
              <body>
                <h2>${result.toolName}</h2>
                <pre>${JSON.stringify(result.result, null, 2)}</pre>
              </body>
            </html>
          `)
          newWindow.document.close()
        }
      }
    },
    [results]
  )

  const openSaveDialog = useCallback(() => {
    if (!selectedTool) return
    setRequestName('')
    setSaveDialogOpen(true)
  }, [selectedTool])

  const saveRequest = useCallback(() => {
    if (!selectedTool) return

    const newRequest: SavedRequest = {
      id: `${Date.now()}-${Math.random()}`,
      name:
        requestName.trim() ||
        `${selectedTool.name} - ${new Date().toLocaleString()}`,
      toolName: selectedTool.name,
      args: toolArgs,
      savedAt: Date.now(),
    }

    saveSavedRequests([...savedRequests, newRequest])
    setSaveDialogOpen(false)
    setRequestName('')
  }, [selectedTool, requestName, toolArgs, savedRequests, saveSavedRequests])

  const deleteSavedRequest = useCallback(
    (id: string) => {
      saveSavedRequests(savedRequests.filter((r) => r.id !== id))
    },
    [savedRequests, saveSavedRequests]
  )

  return (
    <ResizablePanelGroup direction="horizontal" className="h-full">
      <ResizablePanel
        defaultSize={33}
        className="flex flex-col h-full relative"
      >
        <ToolsTabHeader
          activeTab={activeTab}
          isSearchExpanded={isSearchExpanded}
          searchQuery={searchQuery}
          filteredToolsCount={filteredTools.length}
          savedRequestsCount={savedRequests.length}
          onSearchExpand={() => setIsSearchExpanded(true)}
          onSearchChange={setSearchQuery}
          onSearchBlur={handleSearchBlur}
          onTabSwitch={() =>
            setActiveTab(activeTab === 'tools' ? 'saved' : 'tools')
          }
          searchInputRef={searchInputRef as React.RefObject<HTMLInputElement>}
        />

        {activeTab === 'tools' ? (
          <ToolsList
            tools={filteredTools}
            selectedTool={selectedTool}
            onToolSelect={handleToolSelect}
            focusedIndex={focusedIndex}
          />
        ) : (
          <SavedRequestsList
            savedRequests={savedRequests}
            onLoadRequest={loadSavedRequest}
            onDeleteRequest={deleteSavedRequest}
            focusedIndex={focusedIndex}
          />
        )}
      </ResizablePanel>

      <ResizableHandle withHandle />

      <ResizablePanel defaultSize={67}>
        <ResizablePanelGroup direction="vertical">
          <ResizablePanel defaultSize={40}>
            <ToolExecutionPanel
              selectedTool={selectedTool}
              toolArgs={toolArgs}
              isExecuting={isExecuting}
              isConnected={isConnected}
              onArgChange={handleArgChange}
              onExecute={executeTool}
              onSave={openSaveDialog}
            />
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={60}>
            <div className="flex flex-col h-full">
              <ToolResultDisplay
                results={results}
                copiedResult={copiedResult}
                previewMode={previewMode}
                onCopy={handleCopyResult}
                onDelete={handleDeleteResult}
                onFullscreen={handleFullscreen}
                onTogglePreview={() => setPreviewMode(!previewMode)}
              />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>

      <SaveRequestDialog
        isOpen={saveDialogOpen}
        requestName={requestName}
        defaultPlaceholder={`${
          selectedTool?.name
        } - ${new Date().toLocaleString()}`}
        onRequestNameChange={setRequestName}
        onSave={saveRequest}
        onCancel={() => setSaveDialogOpen(false)}
      />
    </ResizablePanelGroup>
  )
}

ToolsTab.displayName = 'ToolsTab'
