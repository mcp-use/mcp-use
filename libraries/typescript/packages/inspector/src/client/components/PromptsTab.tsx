import type { Prompt } from '@modelcontextprotocol/sdk/types.js'
import { Check, Copy, MessageSquare, Play, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { usePrismTheme } from '@/client/hooks/usePrismTheme'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

interface PromptsTabProps {
  prompts: Prompt[]
  callPrompt: (name: string, args?: Record<string, unknown>) => Promise<any>
  isConnected: boolean
}

interface PromptResult {
  promptName: string
  args: Record<string, unknown>
  result: any
  error?: string
  timestamp: number
}

export function PromptsTab({ prompts, callPrompt, isConnected }: PromptsTabProps) {
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null)
  const { prismStyle } = usePrismTheme()
  const [promptArgs, setPromptArgs] = useState<Record<string, unknown>>({})
  const [results, setResults] = useState<PromptResult[]>([])
  const [isExecuting, setIsExecuting] = useState(false)
  const [copiedResult, setCopiedResult] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState('prompts')
  const searchInputRef = useRef<globalThis.HTMLInputElement>(null)

  const handlePromptSelect = useCallback((prompt: Prompt) => {
    setSelectedPrompt(prompt)
    // Initialize args with default values based on prompt input schema
    const initialArgs: Record<string, unknown> = {}
    if (prompt.arguments) {
      Object.entries(prompt.arguments).forEach(([key, prop]) => {
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
    setPromptArgs(initialArgs)
  }, [])

  // Auto-focus the search input when the component mounts
  useEffect(() => {
    if (searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [])

  // Handle auto-selection from command palette
  useEffect(() => {
    const selectedPromptName = sessionStorage.getItem('selected-prompts')
    if (selectedPromptName && prompts.length > 0) {
      const prompt = prompts.find(p => p.name === selectedPromptName)
      if (prompt) {
        handlePromptSelect(prompt)
        sessionStorage.removeItem('selected-prompts')
      }
    }
  }, [prompts, handlePromptSelect])

  const handleArgChange = useCallback((key: string, value: any) => {
    setPromptArgs(prev => ({ ...prev, [key]: value }))
  }, [])

  const handleExecutePrompt = useCallback(async () => {
    if (!selectedPrompt || !isConnected)
      return

    setIsExecuting(true)
    const timestamp = Date.now()

    try {
      const result = await callPrompt(selectedPrompt.name, promptArgs)
      setResults(prev => [{
        promptName: selectedPrompt.name,
        args: promptArgs,
        result,
        timestamp,
      }, ...prev])
    }
    catch (error) {
      setResults(prev => [{
        promptName: selectedPrompt.name,
        args: promptArgs,
        result: null,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp,
      }, ...prev])
    }
    finally {
      setIsExecuting(false)
    }
  }, [selectedPrompt, promptArgs, callPrompt, isConnected])

  const handleCopyResult = useCallback((index: number) => {
    const result = results[index]
    const resultText = result.error ? result.error : JSON.stringify(result.result, null, 2)
    navigator.clipboard.writeText(resultText)
    setCopiedResult(index)
    setTimeout(() => setCopiedResult(null), 2000)
  }, [results])

  const filteredPrompts = useMemo(() => {
    if (!searchQuery)
      return prompts
    return prompts.filter(prompt =>
      prompt.name.toLowerCase().includes(searchQuery.toLowerCase())
      || prompt.description?.toLowerCase().includes(searchQuery.toLowerCase()),
    )
  }, [prompts, searchQuery])

  const renderInputField = (key: string, prop: any) => {
    const value = promptArgs[key]
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value)

    if (prop.type === 'boolean') {
      return (
        <div key={key} className="space-y-2">
          <Label htmlFor={key} className="text-sm font-medium">
            {key}
            {prop.required && <span className="text-red-500 ml-1">*</span>}
          </Label>
          <div className="flex items-center space-x-2">
            <input
              id={key}
              type="checkbox"
              checked={Boolean(value)}
              onChange={e => handleArgChange(key, e.target.checked)}
              className="rounded"
              aria-label={`Toggle ${key}`}
            />
            <span className="text-sm text-gray-600">{prop.description}</span>
          </div>
        </div>
      )
    }

    if (prop.type === 'number') {
      return (
        <div key={key} className="space-y-2">
          <Label htmlFor={key} className="text-sm font-medium">
            {key}
            {prop.required && <span className="text-red-500 ml-1">*</span>}
          </Label>
          <Input
            id={key}
            type="number"
            value={Number(value) || 0}
            onChange={e => handleArgChange(key, Number(e.target.value))}
            placeholder={prop.description || `Enter ${key}`}
          />
          {prop.description && (
            <p className="text-xs text-gray-500">{prop.description}</p>
          )}
        </div>
      )
    }

    if (prop.type === 'array' || prop.type === 'object') {
      return (
        <div key={key} className="space-y-2">
          <Label htmlFor={key} className="text-sm font-medium">
            {key}
            {prop.required && <span className="text-red-500 ml-1">*</span>}
          </Label>
          <Textarea
            id={key}
            value={stringValue}
            onChange={(e) => {
              try {
                const parsed = JSON.parse(e.target.value)
                handleArgChange(key, parsed)
              }
              catch {
                handleArgChange(key, e.target.value)
              }
            }}
            placeholder={prop.description || `Enter ${key} as JSON`}
            className="font-mono text-sm"
            rows={4}
          />
          {prop.description && (
            <p className="text-xs text-gray-500">{prop.description}</p>
          )}
        </div>
      )
    }

    return (
      <div key={key} className="space-y-2">
        <Label htmlFor={key} className="text-sm font-medium">
          {key}
          {prop.required && <span className="text-red-500 ml-1">*</span>}
        </Label>
        <Input
          id={key}
          value={stringValue}
          onChange={e => handleArgChange(key, e.target.value)}
          placeholder={prop.description || `Enter ${key}`}
        />
        {prop.description && (
          <p className="text-xs text-gray-500">{prop.description}</p>
        )}
      </div>
    )
  }

  return (
    <ResizablePanelGroup direction="horizontal" className="h-full">
      <ResizablePanel defaultSize={33}>
        {/* Left pane: Prompts list with search */}
        <div className="flex flex-col h-full border-r dark:border-zinc-700 p-6 bg-white dark:bg-zinc-800">
          <div className="p-0 ">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-2 bg-zinc-100 dark:bg-zinc-700 rounded-full">
                <TabsTrigger value="prompts">
                  Prompts
                  <Badge className="ml-2" variant="outline">{filteredPrompts.length}</Badge>
                </TabsTrigger>
                <TabsTrigger value="saved">Saved Requests</TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="mt-4 relative">
              <Search className="absolute left-3 top-1/2 border-none transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                ref={searchInputRef}
                placeholder="Search prompts by name or description"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-10 bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-all border-none rounded-full"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto overflow-x-visible mt-6 space-y-5 p-2">
            {filteredPrompts.length === 0
              ? (
                  <div className="text-center py-8 text-gray-500">
                    <MessageSquare className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                    <p className="text-lg font-medium">No prompts found</p>
                    <p className="text-sm">
                      {searchQuery ? 'Try adjusting your search terms' : 'This server has no prompts available'}
                    </p>
                  </div>
                )
              : (
                  filteredPrompts.map(prompt => (
                    <Card
                      key={prompt.name}
                      className={cn(
                        'cursor-pointer transition-all hover:shadow-md',
                        selectedPrompt?.name === prompt.name && 'ring-2 ring-blue-500 shadow-md',
                      )}
                      onClick={() => handlePromptSelect(prompt)}
                    >
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <CardTitle className="text-base font-medium truncate">
                              {prompt.name}
                            </CardTitle>
                            <CardDescription className="text-sm text-gray-600 mt-1 line-clamp-2">
                              {prompt.description || 'No description available'}
                            </CardDescription>
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
        {/* Right pane: Prompt details and execution */}
        <div className="flex flex-col h-full bg-white dark:bg-zinc-800 p-6">
          {selectedPrompt
            ? (
                <>
                  <div className="mb-6">
                    <h3 className="text-lg font-semibold mb-2">{selectedPrompt.name}</h3>
                    <p className="text-sm text-gray-600 mb-4">
                      {selectedPrompt.description || 'No description available'}
                    </p>

                    {selectedPrompt.arguments && Object.keys(selectedPrompt.arguments).length > 0 && (
                      <div className="space-y-4 mb-6">
                        <h4 className="text-sm font-medium text-gray-700">Arguments</h4>
                        <div className="space-y-4">
                          {Object.entries(selectedPrompt.arguments).map(([key, prop]) =>
                            renderInputField(key, prop),
                          )}
                        </div>
                      </div>
                    )}

                    <Button
                      onClick={handleExecutePrompt}
                      disabled={!isConnected || isExecuting}
                      className="w-full"
                    >
                      {isExecuting
                        ? (
                            <>
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                              Executing...
                            </>
                          )
                        : (
                            <>
                              <Play className="h-4 w-4 mr-2" />
                              Execute Prompt
                            </>
                          )}
                    </Button>
                  </div>

                  {results.length > 0 && (
                    <div className="flex-1 overflow-hidden">
                      <h4 className="text-sm font-medium text-gray-700 mb-3">Results</h4>
                      <div className="space-y-3 overflow-y-auto max-h-96">
                        {results.map((result, index) => (
                          <div key={index} className="border dark:border-zinc-700 rounded-lg p-3 bg-gray-50 dark:bg-zinc-700">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-medium text-gray-700">
                                {result.promptName}
                              </span>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleCopyResult(index)}
                                className="h-6 w-6 p-0"
                              >
                                {copiedResult === index
                                  ? (
                                      <Check className="h-3 w-3 text-green-600" />
                                    )
                                  : (
                                      <Copy className="h-3 w-3" />
                                    )}
                              </Button>
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
                              : (
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
                                )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )
            : (
                <div className="flex-1 flex items-center justify-center text-gray-500">
                  <div className="text-center">
                    <MessageSquare className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                    <p className="text-lg font-medium">Select a prompt</p>
                    <p className="text-sm">Choose a prompt from the list to see details and execute it</p>
                  </div>
                </div>
              )}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
