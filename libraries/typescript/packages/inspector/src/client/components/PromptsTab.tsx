import type { Prompt } from '@modelcontextprotocol/sdk/types.js'
import { Check, Clock, Copy, MessageSquare, Play } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { ListItem, ListTabHeader } from '@/client/components/shared'
import { Button } from '@/client/components/ui/button'
import { Input } from '@/client/components/ui/input'
import { Label } from '@/client/components/ui/label'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/client/components/ui/resizable'
import { Textarea } from '@/client/components/ui/textarea'
import { useInspector } from '@/client/context/InspectorContext'
import { usePrismTheme } from '@/client/hooks/usePrismTheme'

export interface PromptsTabRef {
  focusSearch: () => void
  blurSearch: () => void
}

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

export function PromptsTab({
  ref,
  prompts,
  callPrompt,
  isConnected,
}: PromptsTabProps & { ref?: React.RefObject<PromptsTabRef | null> }) {
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null)
  const { selectedPromptName, setSelectedPromptName } = useInspector()
  const { prismStyle } = usePrismTheme()
  const [promptArgs, setPromptArgs] = useState<Record<string, unknown>>({})
  const [results, setResults] = useState<PromptResult[]>([])
  const [isExecuting, setIsExecuting] = useState(false)
  const [copiedResult, setCopiedResult] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState('prompts')
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

  const filteredPrompts = useMemo(() => {
    if (!searchQuery) return prompts
    return prompts.filter(
      (prompt) =>
        prompt.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        prompt.description?.toLowerCase().includes(searchQuery.toLowerCase())
    )
  }, [prompts, searchQuery])

  const handlePromptSelect = useCallback((prompt: Prompt) => {
    setSelectedPrompt(prompt)
    // Initialize args with default values based on prompt input schema
    const initialArgs: Record<string, unknown> = {}
    if (prompt.arguments) {
      Object.entries(prompt.arguments).forEach(([key, prop]) => {
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
    setPromptArgs(initialArgs)
  }, [])

  // Reset focused index when filtered prompts change
  useEffect(() => {
    setFocusedIndex(-1)
  }, [searchQuery, activeTab])

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
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

      const items = activeTab === 'prompts' ? filteredPrompts : results

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
        if (activeTab === 'prompts') {
          const prompt = filteredPrompts[focusedIndex]
          if (prompt) {
            handlePromptSelect(prompt)
          }
        } else {
          const result = results[focusedIndex]
          if (result) {
            const prompt = prompts.find((p) => p.name === result.promptName)
            if (prompt) {
              handlePromptSelect(prompt)
              setPromptArgs(result.args)
              // Don't switch tabs - let user stay in history view
              // setActiveTab('prompts')
            }
          }
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [
    focusedIndex,
    filteredPrompts,
    results,
    activeTab,
    handlePromptSelect,
    prompts,
  ])

  // Scroll focused item into view
  useEffect(() => {
    if (focusedIndex >= 0) {
      const itemId =
        activeTab === 'prompts'
          ? `prompt-${filteredPrompts[focusedIndex]?.name}`
          : `prompt-result-${focusedIndex}`
      const element = document.getElementById(itemId)
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    }
  }, [focusedIndex, filteredPrompts, activeTab])

  // Handle auto-selection from context
  useEffect(() => {
    console.warn('[PromptsTab] Auto-selection effect triggered:', {
      selectedPromptName,
      promptsCount: prompts.length,
      currentSelectedPrompt: selectedPrompt?.name,
    })

    if (selectedPromptName && prompts.length > 0) {
      const prompt = prompts.find((p) => p.name === selectedPromptName)
      console.warn('[PromptsTab] Prompt lookup result:', {
        selectedPromptName,
        promptFound: !!prompt,
        promptName: prompt?.name,
        shouldSelect: prompt && selectedPrompt?.name !== prompt.name,
      })

      if (prompt && selectedPrompt?.name !== prompt.name) {
        console.warn('[PromptsTab] Selecting prompt:', prompt.name)
        // Clear the selection from context after processing
        setSelectedPromptName(null)
        // Use setTimeout to ensure the component is fully rendered
        setTimeout(() => {
          handlePromptSelect(prompt)
          // Scroll to the selected prompt
          const promptElement = document.getElementById(`prompt-${prompt.name}`)
          if (promptElement) {
            console.warn('[PromptsTab] Scrolling to prompt element')
            promptElement.scrollIntoView({
              behavior: 'smooth',
              block: 'nearest',
            })
          }
        }, 100)
      }
    }
  }, [
    selectedPromptName,
    prompts,
    selectedPrompt,
    handlePromptSelect,
    setSelectedPromptName,
  ])

  const handleArgChange = useCallback((key: string, value: any) => {
    setPromptArgs((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleExecutePrompt = useCallback(async () => {
    if (!selectedPrompt || !isConnected) return

    setIsExecuting(true)
    const timestamp = Date.now()

    try {
      const result = await callPrompt(selectedPrompt.name, promptArgs)
      setResults((prev) => [
        {
          promptName: selectedPrompt.name,
          args: promptArgs,
          result,
          timestamp,
        },
        ...prev,
      ])
    } catch (error) {
      setResults((prev) => [
        {
          promptName: selectedPrompt.name,
          args: promptArgs,
          result: null,
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp,
        },
        ...prev,
      ])
    } finally {
      setIsExecuting(false)
    }
  }, [selectedPrompt, promptArgs, callPrompt, isConnected])

  const handleCopyResult = useCallback(
    (index: number) => {
      const result = results[index]
      const resultText = result.error
        ? result.error
        : JSON.stringify(result.result, null, 2)
      navigator.clipboard.writeText(resultText)
      setCopiedResult(index)
      setTimeout(() => setCopiedResult(null), 2000)
    },
    [results]
  )

  const renderInputField = (key: string, prop: any) => {
    const value = promptArgs[key]
    const stringValue =
      typeof value === 'string' ? value : JSON.stringify(value)

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
              onChange={(e) => handleArgChange(key, e.target.checked)}
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
            onChange={(e) => handleArgChange(key, Number(e.target.value))}
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
              } catch {
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
          onChange={(e) => handleArgChange(key, e.target.value)}
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
        <ListTabHeader
          activeTab={activeTab}
          isSearchExpanded={isSearchExpanded}
          searchQuery={searchQuery}
          primaryTabName="prompts"
          secondaryTabName="saved"
          primaryTabTitle="Prompts"
          secondaryTabTitle="History"
          primaryCount={filteredPrompts.length}
          secondaryCount={results.length}
          primaryIcon={MessageSquare}
          secondaryIcon={Clock}
          searchPlaceholder="Search prompts..."
          onSearchExpand={() => setIsSearchExpanded(true)}
          onSearchChange={setSearchQuery}
          onSearchBlur={handleSearchBlur}
          onTabSwitch={() =>
            setActiveTab(activeTab === 'prompts' ? 'saved' : 'prompts')
          }
          searchInputRef={searchInputRef as React.RefObject<HTMLInputElement>}
        />
        {/* Left pane: Prompts list */}
        <div className="flex flex-col h-full">
          {activeTab === 'prompts' ? (
            <div className="overflow-y-auto flex-1 border-r dark:border-zinc-700 overscroll-contain">
              {filteredPrompts.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full p-4 text-center">
                  <MessageSquare className="h-12 w-12 text-gray-400 dark:text-gray-600 mb-3" />
                  <p className="text-gray-500 dark:text-gray-400">
                    No prompts available
                  </p>
                </div>
              ) : (
                filteredPrompts.map((prompt, index) => (
                  <ListItem
                    key={prompt.name}
                    id={`prompt-${prompt.name}`}
                    isSelected={selectedPrompt?.name === prompt.name}
                    isFocused={focusedIndex === index}
                    icon={<MessageSquare className="h-4 w-4" />}
                    title={prompt.name}
                    description={prompt.description}
                    onClick={() => handlePromptSelect(prompt)}
                  />
                ))
              )}
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto border-r dark:border-zinc-700">
              {results.length === 0 ? (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  <p>No history</p>
                  <p className="text-sm">
                    Prompts you execute will appear here
                  </p>
                </div>
              ) : (
                <div className="space-y-2 p-4">
                  {results.map((result, index) => (
                    <div
                      key={index}
                      id={`prompt-result-${index}`}
                      className="p-3 bg-gray-100 dark:bg-zinc-800 rounded cursor-pointer hover:bg-gray-200 dark:hover:bg-zinc-700"
                      onClick={() => {
                        const prompt = prompts.find(
                          (p) => p.name === result.promptName
                        )
                        if (prompt) {
                          handlePromptSelect(prompt)
                          setPromptArgs(result.args)
                          // Don't switch tabs - let user stay in history view
                          // setActiveTab('prompts')
                        }
                      }}
                    >
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        {result.promptName}
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

      <ResizableHandle withHandle />

      <ResizablePanel defaultSize={67}>
        {/* Right pane: Prompt details and execution */}
        <div className="flex flex-col h-full bg-white dark:bg-black p-6">
          {selectedPrompt ? (
            <>
              <div className="mb-6">
                <h3 className="text-lg font-semibold mb-2">
                  {selectedPrompt.name}
                </h3>
                <p className="text-sm text-gray-600 mb-4">
                  {selectedPrompt.description || 'No description available'}
                </p>

                {selectedPrompt.arguments &&
                  Object.keys(selectedPrompt.arguments).length > 0 && (
                    <div className="space-y-4 mb-6">
                      <h4 className="text-sm font-medium text-gray-700">
                        Arguments
                      </h4>
                      <div className="space-y-4">
                        {Object.entries(selectedPrompt.arguments).map(
                          ([key, prop]) => renderInputField(key, prop)
                        )}
                      </div>
                    </div>
                  )}

                <Button
                  onClick={handleExecutePrompt}
                  disabled={!isConnected || isExecuting}
                  className="w-full"
                >
                  {isExecuting ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                      Executing...
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 mr-2" />
                      Execute Prompt
                    </>
                  )}
                </Button>
              </div>

              {results.length > 0 && (
                <div className="flex-1 overflow-hidden">
                  <h4 className="text-sm font-medium text-gray-700 mb-3">
                    Results
                  </h4>
                  <div className="space-y-3 overflow-y-auto max-h-96">
                    {results.map((result, index) => (
                      <div
                        key={index}
                        className="border dark:border-zinc-700 rounded-lg p-3 bg-gray-50 dark:bg-zinc-700"
                      >
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
                            {copiedResult === index ? (
                              <Check className="h-3 w-3 text-green-600" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                        <div className="text-xs text-gray-500 mb-2">
                          {new Date(result.timestamp).toLocaleString()}
                        </div>
                        {result.error ? (
                          <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-2 rounded">
                            {result.error}
                          </div>
                        ) : (
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
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-500">
              <div className="text-center">
                <MessageSquare className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                <p className="text-lg font-medium">Select a prompt</p>
                <p className="text-sm">
                  Choose a prompt from the list to see details and execute it
                </p>
              </div>
            </div>
          )}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

PromptsTab.displayName = 'PromptsTab'
