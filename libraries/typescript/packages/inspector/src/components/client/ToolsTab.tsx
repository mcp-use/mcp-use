import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { Check, Clock, Copy, Maximize, Play, Save, Search, Trash2, Wrench, Zap } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { usePrismTheme } from '@/client/hooks/usePrismTheme'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { isMcpUIResource, McpUIRenderer } from './McpUIRenderer'

interface ToolsTabProps {
  tools: Tool[]
  callTool: (name: string, args?: Record<string, unknown>) => Promise<any>
  isConnected: boolean
}

interface ToolResult {
  toolName: string
  args: Record<string, unknown>
  result: any
  error?: string
  timestamp: number
  duration?: number
}

interface SavedRequest {
  id: string
  name: string
  toolName: string
  args: Record<string, unknown>
  savedAt: number
}

const SAVED_REQUESTS_KEY = 'mcp-inspector-saved-requests'

export function ToolsTab({ tools, callTool, isConnected }: ToolsTabProps) {
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null)
  const { prismStyle } = usePrismTheme()
  const [toolArgs, setToolArgs] = useState<Record<string, unknown>>({})
  const [results, setResults] = useState<ToolResult[]>([])
  const [isExecuting, setIsExecuting] = useState(false)
  const [copiedResult, setCopiedResult] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState('tools')
  const [savedRequests, setSavedRequests] = useState<SavedRequest[]>([])
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [requestName, setRequestName] = useState('')
  const [previewMode, setPreviewMode] = useState(true)
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  // Load saved requests from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SAVED_REQUESTS_KEY)
      if (saved) {
        setSavedRequests(JSON.parse(saved))
      }
    }
    catch (error) {
      console.error('Failed to load saved requests:', error)
    }
  }, [])

  // Save to localStorage whenever savedRequests changes
  const saveSavedRequests = useCallback((requests: SavedRequest[]) => {
    try {
      localStorage.setItem(SAVED_REQUESTS_KEY, JSON.stringify(requests))
      setSavedRequests(requests)
    }
    catch (error) {
      console.error('Failed to save requests:', error)
    }
  }, [])

  // Auto-focus the search input when the component mounts
  useEffect(() => {
    if (searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [])

  const handleToolSelect = useCallback((tool: Tool) => {
    setSelectedTool(tool)
    // Initialize args with default values based on tool input schema
    const initialArgs: Record<string, unknown> = {}
    if (tool.inputSchema?.properties) {
      Object.entries(tool.inputSchema.properties).forEach(([key, prop]) => {
        const typedProp = prop as any
        if (typedProp.default !== undefined) {
          initialArgs[key] = typedProp.default
        }
        else if (typedProp.type === 'string') {
          initialArgs[key] = ''
        }
        else if (typedProp.type === 'number') {
          initialArgs[key] = 0
        }
        else if (typedProp.type === 'boolean') {
          initialArgs[key] = false
        }
        else if (typedProp.type === 'array') {
          initialArgs[key] = []
        }
        else if (typedProp.type === 'object') {
          initialArgs[key] = {}
        }
      })
    }
    setToolArgs(initialArgs)
  }, [])

  // Handle auto-selection from command palette
  useEffect(() => {
    const selectedToolName = sessionStorage.getItem('selected-tools')
    if (selectedToolName && tools.length > 0) {
      const tool = tools.find(t => t.name === selectedToolName)
      if (tool) {
        handleToolSelect(tool)
        sessionStorage.removeItem('selected-tools')
      }
    }
  }, [tools, handleToolSelect])

  const handleArgChange = useCallback((key: string, value: string) => {
    setToolArgs((prev) => {
      const newArgs = { ...prev }

      // Check the tool's input schema to determine how to handle the value
      if (selectedTool?.inputSchema?.properties?.[key]) {
        const prop = selectedTool.inputSchema.properties[key] as any
        const expectedType = prop.type

        if (expectedType === 'string') {
          // For string parameters, don't parse JSON - treat as literal string
          newArgs[key] = value
        }
        else {
          // For non-string parameters, try to parse as JSON first, fallback to string
          try {
            newArgs[key] = JSON.parse(value)
          }
          catch {
            newArgs[key] = value
          }
        }
      }
      else {
        // Fallback: try to parse as JSON first, fallback to string
        try {
          newArgs[key] = JSON.parse(value)
        }
        catch {
          newArgs[key] = value
        }
      }

      return newArgs
    })
  }, [selectedTool])

  const executeTool = useCallback(async () => {
    if (!selectedTool || !isConnected)
      return

    setIsExecuting(true)
    const startTime = Date.now()

    try {
      const result = await callTool(selectedTool.name, toolArgs)
      const duration = Date.now() - startTime
      const newResult: ToolResult = {
        toolName: selectedTool.name,
        args: toolArgs,
        result,
        timestamp: startTime,
        duration,
      }
      setResults(prev => [newResult, ...prev])
    }
    catch (error) {
      const duration = Date.now() - startTime
      const newResult: ToolResult = {
        toolName: selectedTool.name,
        args: toolArgs,
        result: null,
        error: error instanceof Error ? error.message : String(error),
        timestamp: startTime,
        duration,
      }
      setResults(prev => [newResult, ...prev])
    }
    finally {
      setIsExecuting(false)
    }
  }, [selectedTool, toolArgs, callTool, isConnected])

  const copyResult = useCallback(async (index: number) => {
    const result = results[index]
    const textToCopy = result.error
      ? `Error: ${result.error}`
      : JSON.stringify(result.result, null, 2)

    try {
      await navigator.clipboard.writeText(textToCopy)
      setCopiedResult(index)
      setTimeout(() => setCopiedResult(null), 2000)
    }
    catch (err) {
      console.error('Failed to copy:', err)
    }
  }, [results])

  const handleFullscreen = useCallback(async (index: number) => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      }
      else {
        // Find the specific tool result div
        const resultDiv = document.querySelector(`[data-result-index="${index}"]`)
        if (resultDiv) {
          await resultDiv.requestFullscreen()
        }
      }
    }
    catch (error) {
      console.error('Failed to toggle fullscreen:', error)
    }
  }, [])

  const saveRequest = useCallback(() => {
    if (!selectedTool)
      return

    const name = requestName.trim() || `${selectedTool.name} - ${new Date().toLocaleString()}`
    const newRequest: SavedRequest = {
      id: `${Date.now()}-${Math.random()}`,
      name,
      toolName: selectedTool.name,
      args: toolArgs,
      savedAt: Date.now(),
    }

    const updatedRequests = [newRequest, ...savedRequests]
    saveSavedRequests(updatedRequests)
    setRequestName('')
    setSaveDialogOpen(false)
  }, [selectedTool, toolArgs, requestName, savedRequests, saveSavedRequests])

  const loadSavedRequest = useCallback((request: SavedRequest) => {
    const tool = tools.find(t => t.name === request.toolName)
    if (tool) {
      setSelectedTool(tool)
      setToolArgs(request.args)
      setActiveTab('tools')
    }
  }, [tools])

  const deleteSavedRequest = useCallback((id: string) => {
    const updatedRequests = savedRequests.filter(req => req.id !== id)
    saveSavedRequests(updatedRequests)
  }, [savedRequests, saveSavedRequests])

  // Filter tools based on search query
  const filteredTools = useMemo(() => {
    if (!searchQuery.trim())
      return tools

    const query = searchQuery.toLowerCase()
    return tools.filter(tool =>
      tool.name.toLowerCase().includes(query)
      || tool.description?.toLowerCase().includes(query),
    )
  }, [tools, searchQuery])

  const renderInputField = (key: string, prop: any) => {
    const value = toolArgs[key]
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value)
    const typedProp = prop as any

    if (typedProp?.type === 'boolean') {
      return (
        <div key={key} className="space-y-2">
          <Label htmlFor={key} className="text-sm font-medium">
            {key}
            {typedProp?.required && <span className="text-red-500 ml-1">*</span>}
          </Label>
          <div className="flex items-center space-x-2">
            <input
              id={key}
              type="checkbox"
              checked={Boolean(value)}
              onChange={e => handleArgChange(key, e.target.checked.toString())}
              className="rounded border-gray-300"
              aria-label={`${key} checkbox`}
            />
            <span className="text-sm text-gray-600 dark:text-gray-300">{typedProp?.description || ''}</span>
          </div>
        </div>
      )
    }

    if (typedProp?.type === 'string' && (typedProp?.format === 'multiline' || stringValue.length > 50)) {
      return (
        <div key={key} className="space-y-2">
          <Label htmlFor={key} className="text-sm font-medium">
            {key}
            {typedProp?.required && <span className="text-red-500 ml-1">*</span>}
          </Label>
          <Textarea
            id={key}
            value={stringValue}
            onChange={e => handleArgChange(key, e.target.value)}
            placeholder={typedProp?.description || `Enter ${key}`}
            className="min-h-[100px]"
          />
          {typedProp?.description && (
            <p className="text-xs text-gray-500 dark:text-gray-400">{typedProp.description}</p>
          )}
        </div>
      )
    }

    return (
      <div key={key} className="space-y-2">
        <Label htmlFor={key} className="text-sm font-medium">
          {key}
          {typedProp?.required && <span className="text-red-500 ml-1">*</span>}
        </Label>
        <Input
          id={key}
          value={stringValue}
          onChange={e => handleArgChange(key, e.target.value)}
          placeholder={typedProp?.description || `Enter ${key}`}
        />
        {typedProp?.description && (
          <p className="text-xs text-gray-500 dark:text-gray-400">{typedProp.description}</p>
        )}
      </div>
    )
  }

  return (
    <ResizablePanelGroup direction="horizontal" className="h-full">
      <ResizablePanel defaultSize={33}>
        {/* Left pane: Tools list with search */}
        <div className="flex flex-col h-full border-r dark:border-zinc-700 p-6 bg-white dark:bg-black">
          <div className="p-0 ">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-2 bg-bla dark:bg-black rounded-full">
                <TabsTrigger value="tools">
                  Tools
                  <Badge className="ml-2" variant="outline">{filteredTools.length}</Badge>
                </TabsTrigger>
                <TabsTrigger value="saved">Saved Requests</TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="mt-4 relative">
              <Search className="absolute left-3 top-1/2 border-none transform -translate-y-1/2 text-gray-400 dark:text-gray-500 h-4 w-4" />
              <Input
                ref={searchInputRef}
                placeholder="Search tools by name or description "
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-10 p-4 rounded-xl bg-white/80 dark:text-white dark:bg-black backdrop-blur-sm border-gray-200 dark:border-zinc-800"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto overflow-x-visible mt-6 space-y-5 p-0">
            {activeTab === 'tools'
              ? (
                  <>
                    {filteredTools.length === 0
                      ? (
                          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                            <p>No tools available</p>
                            <p className="text-sm">Connect to a server to see tools</p>
                          </div>
                        )
                      : (
                          filteredTools.map(tool => (
                            <div
                              key={tool.name}
                              className={cn(
                                'cursor-pointer transition-all rounded-[20px] bg-zinc-100 dark:bg-white/10 hover:bg-zinc-200 dark:hover:bg-white/15 p-2',
                                selectedTool?.name === tool.name && 'border-2 border-zinc-200 dark:border-zinc-600',
                              )}
                              onClick={() => handleToolSelect(tool)}
                            >
                              <div className="flex items-center gap-3">
                                <div className="bg-blue-500/20 rounded-full p-3 flex items-center justify-center">
                                  <Wrench className="h-5 w-5 text-blue-500" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{tool.name}</div>
                                  {tool.description && (
                                    <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                                      {tool.description}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                  </>
                )
              : (
                  <>
                    {savedRequests.length === 0
                      ? (
                          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                            <p>No saved requests</p>
                            <p className="text-sm">Save a tool configuration to reuse it later</p>
                          </div>
                        )
                      : (
                          savedRequests.map(request => (
                            <div
                              key={request.id}
                              className="cursor-pointer transition-all rounded-md border border-gray-200 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700 p-3 group"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div
                                  className="flex-1"
                                  onClick={() => loadSavedRequest(request)}
                                >
                                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{request.name}</div>
                                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                    <Badge variant="outline" className="mr-2">{request.toolName}</Badge>
                                    <span>{new Date(request.savedAt).toLocaleString()}</span>
                                  </div>
                                  {Object.keys(request.args).length > 0 && (
                                    <div className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                                      {Object.keys(request.args).length}
                                      {' '}
                                      parameter(s)
                                    </div>
                                  )}
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    deleteSavedRequest(request.id)
                                  }}
                                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  <Trash2 className="h-4 w-4 text-red-500" />
                                </Button>
                              </div>
                            </div>
                          ))
                        )}
                  </>
                )}
          </div>
        </div>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={67}>

        <ResizablePanelGroup direction="vertical">
          <ResizablePanel defaultSize={40}>

            {/* Right pane: Tool form */}
            <div className="flex flex-col h-full bg-white dark:bg-black">
              {selectedTool
                ? (
                    <div className="flex flex-col h-full">
                      <div className="p-4 ">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="space-x-2 flex items-center">
                              <div className="bg-blue-500/20 rounded-full p-3 flex items-center justify-center">
                                <Wrench className="h-5 w-5 text-blue-500" />
                              </div>
                              <div>
                                <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                  {selectedTool.name}
                                </h3>
                                {selectedTool.description && (
                                  <p className="text-sm text-gray-600 dark:text-gray-300">{selectedTool.description}</p>
                                )}
                              </div>
                            </div>

                          </div>
                          <div className="flex items-center gap-2">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setSaveDialogOpen(true)}
                                  disabled={!selectedTool}
                                >
                                  <Save className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Save request</p>
                              </TooltipContent>
                            </Tooltip>
                            <Button
                              onClick={executeTool}
                              disabled={!isConnected || isExecuting}
                              size="sm"
                            >
                              {isExecuting
                                ? (
                                    <>
                                      <Spinner className="size-4 mr-1" />
                                      Executing...
                                    </>
                                  )
                                : (
                                    <>
                                      <Play className="h-4 w-4 mr-1" />
                                      Execute
                                    </>
                                  )}
                            </Button>
                          </div>
                        </div>

                      </div>

                      <div className="flex-1 overflow-y-auto p-4">
                        {selectedTool.inputSchema?.properties
                          ? (
                              <div className="space-y-4">
                                {Object.entries(selectedTool.inputSchema.properties).map(([key, prop]) =>
                                  renderInputField(key, prop),
                                )}
                              </div>
                            )
                          : (
                              <div className="text-center py-8">
                                <p className="text-gray-500 dark:text-gray-400">This tool has no parameters</p>
                              </div>
                            )}
                      </div>
                    </div>
                  )
                : (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center">
                        <p className="text-gray-500 dark:text-gray-400 text-lg">Select a tool to get started</p>
                        <p className="text-gray-400 dark:text-gray-500 text-sm">Choose a tool from the list to configure and execute it</p>
                      </div>
                    </div>
                  )}
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={60}>

            {/* Bottom section: Results */}
            <div className="flex flex-col h-full bg-white dark:bg-black border-t dark:border-zinc-700">
              <div className="flex-1 overflow-y-auto h-full">
                {results.length > 0
                  ? (
                      <div className="space-y-4 flex-1 h-full">
                        {results.map((result, index) => {
                          // Check if result contains MCP UI resources
                          const content = result.result?.content || []
                          const mcpUIResources = content.filter((item: any) =>
                            item.type === 'resource' && isMcpUIResource(item.resource),
                          )
                          const hasMcpUIResources = mcpUIResources.length > 0

                          return (
                            <div key={index} className="space-y-0 flex-1 h-full" data-result-index={index}>
                              <div className={`flex items-center gap-2 px-4 pt-2 ${hasMcpUIResources ? 'border-b border-gray-200 dark:border-zinc-600 pb-2' : ''}`}>
                                <h3 className="text-sm font-medium">Response</h3>
                                <div className="flex items-center gap-1">
                                  <Clock className="h-3 w-3 text-gray-400" />
                                  <span className="text-xs text-gray-500 dark:text-gray-400">
                                    {new Date(result.timestamp).toLocaleTimeString()}
                                  </span>
                                </div>
                                {result.duration !== undefined && (
                                  <div className="flex items-center gap-1">
                                    <Zap className="h-3 w-3 text-gray-400" />
                                    <span className="text-xs text-gray-500 dark:text-gray-400">
                                      {result.duration}
                                      ms
                                    </span>
                                  </div>
                                )}
                                {hasMcpUIResources && (
                                  <div className="flex items-center gap-4 ml-4">
                                    <span className="text-xs text-gray-500 dark:text-gray-400">
                                      URI:
                                      {' '}
                                      {mcpUIResources[0]?.resource?.uri || 'No URI'}
                                    </span>
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
                                  </div>
                                )}
                                <div className="flex items-center gap-1 ml-auto">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => copyResult(index)}
                                  >
                                    {copiedResult === index
                                      ? (
                                          <Check className="h-4 w-4" />
                                        )
                                      : (
                                          <Copy className="h-4 w-4" />
                                        )}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleFullscreen(index)}
                                  >
                                    <Maximize className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>

                              {result.error
                                ? (
                                    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-3 mx-4">
                                      <p className="text-red-800 dark:text-red-300 font-medium">Error:</p>
                                      <p className="text-red-700 dark:text-red-400 text-sm">{result.error}</p>
                                    </div>
                                  )
                                : (() => {
                                    if (hasMcpUIResources) {
                                      if (previewMode) {
                                        return (
                                          <div className="space-y-0 h-full">
                                            {mcpUIResources.map((item: any, idx: number) => (
                                              <div key={idx} className="mx-0 size-full">
                                                <div className="w-full h-full">
                                                  <McpUIRenderer
                                                    resource={item.resource}
                                                    onUIAction={(_action) => {
                                                    // Handle UI actions here if needed
                                                    }}
                                                    className="w-full h-full"
                                                  />
                                                </div>
                                              </div>
                                            ))}
                                            {/* Show JSON for non-UI content */}
                                            {content.filter((item: any) =>
                                              !(item.type === 'resource' && isMcpUIResource(item.resource)),
                                            ).length > 0 && (
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
                                                    content.filter((item: any) =>
                                                      !(item.type === 'resource' && isMcpUIResource(item.resource)),
                                                    ),
                                                    null,
                                                    2,
                                                  )}
                                                </SyntaxHighlighter>
                                              </div>
                                            )}
                                          </div>
                                        )
                                      }
                                      else {
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
                                              {JSON.stringify(result.result, null, 2)}
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
                                  })()}
                            </div>
                          )
                        })}
                      </div>
                    )
                  : (
                      <div className="flex items-center justify-center h-full">
                        <div className="text-center">
                          <p className="text-gray-500 dark:text-gray-400">No results yet</p>
                          <p className="text-gray-400 dark:text-gray-500 text-sm">Execute a tool to see results here</p>
                        </div>
                      </div>
                    )}
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>

      </ResizablePanel>

      {/* Save Dialog */}
      {saveDialogOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setSaveDialogOpen(false)}>
          <div className="bg-white dark:bg-zinc-800 rounded-lg p-6 w-[400px] shadow-xl border border-gray-200 dark:border-zinc-700" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">Save Request</h3>
            <div className="space-y-4">
              <div>
                <Label htmlFor="request-name">Request Name (optional)</Label>
                <Input
                  id="request-name"
                  value={requestName}
                  onChange={e => setRequestName(e.target.value)}
                  placeholder={`${selectedTool?.name} - ${new Date().toLocaleString()}`}
                  className="mt-2"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      saveRequest()
                    }
                  }}
                  autoFocus
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={saveRequest}>
                  <Save className="h-4 w-4 mr-2" />
                  Save
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </ResizablePanelGroup>
  )
}
