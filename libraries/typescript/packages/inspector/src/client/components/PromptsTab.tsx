import type { Prompt } from '@modelcontextprotocol/sdk/types.js'
import type { PromptResult, SavedPrompt } from './prompts'
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
import { MCPPromptCallEvent, Telemetry } from '@/client/telemetry'
import {
  PromptExecutionPanel,
  PromptResultDisplay,
  PromptsList,
  PromptsTabHeader,
  SavedPromptsList,
} from './prompts'

export interface PromptsTabRef {
  focusSearch: () => void
  blurSearch: () => void
}

interface PromptsTabProps {
  prompts: Prompt[]
  callPrompt: (name: string, args?: Record<string, unknown>) => Promise<any>
  serverId: string
  isConnected: boolean
}

const SAVED_PROMPTS_KEY = 'mcp-inspector-saved-prompts'

export function PromptsTab({
  ref,
  prompts,
  callPrompt,
  serverId,
  isConnected,
}: PromptsTabProps & { ref?: React.RefObject<PromptsTabRef | null> }) {
  // State
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null)
  const [selectedSavedPrompt, setSelectedSavedPrompt] = useState<SavedPrompt | null>(null)
  const { selectedPromptName, setSelectedPromptName } = useInspector()
  const [promptArgs, setPromptArgs] = useState<Record<string, unknown>>({})
  const [results, setResults] = useState<PromptResult[]>([])
  const [isExecuting, setIsExecuting] = useState(false)
  const [copiedResult, setCopiedResult] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'prompts' | 'saved'>('prompts')
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>([])
  const [_saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [_promptName, setPromptName] = useState('')
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

  // Load saved prompts from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SAVED_PROMPTS_KEY)
      if (saved) {
        const parsedPrompts = JSON.parse(saved)
        setSavedPrompts(parsedPrompts)
      }
    }
    catch (error) {
      console.error('[PromptsTab] Failed to load saved prompts:', error)
    }
  }, [])

  // Save to localStorage whenever savedPrompts changes
  const saveSavedPrompts = useCallback((prompts: SavedPrompt[]) => {
    try {
      localStorage.setItem(SAVED_PROMPTS_KEY, JSON.stringify(prompts))
    }
    catch (error) {
      console.error('[PromptsTab] Failed to save prompts:', error)
    }
  }, [])

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

  // Filter prompts based on search query
  const filteredPrompts = useMemo(() => {
    if (!searchQuery.trim())
      return prompts

    const query = searchQuery.toLowerCase()
    return prompts.filter(
      prompt =>
        prompt.name.toLowerCase().includes(query)
        || prompt.description?.toLowerCase().includes(query),
    )
  }, [prompts, searchQuery])

  const handlePromptSelect = useCallback((prompt: Prompt) => {
    setSelectedPrompt(prompt)
    // Initialize args with default values based on prompt input schema
    const initialArgs: Record<string, unknown> = {}
    if (prompt.arguments) {
      // Handle MCP SDK structure: arguments is an array of PromptArgument objects
      prompt.arguments.forEach((arg) => {
        if (arg.default !== undefined) {
          initialArgs[arg.name] = arg.default
        }
        else if (arg.type === 'string') {
          initialArgs[arg.name] = ''
        }
        else if (arg.type === 'number') {
          initialArgs[arg.name] = 0
        }
        else if (arg.type === 'boolean') {
          initialArgs[arg.name] = false
        }
        else if (arg.type === 'array') {
          initialArgs[arg.name] = []
        }
        else if (arg.type === 'object') {
          initialArgs[arg.name] = {}
        }
      })
    }
    setPromptArgs(initialArgs)
  }, [])

  const loadSavedPrompt = useCallback(
    (prompt: SavedPrompt) => {
      const promptObj = prompts.find(p => p.name === prompt.promptName)
      if (promptObj) {
        setSelectedPrompt(promptObj)
        setPromptArgs(prompt.args)
        setSelectedSavedPrompt(prompt)
      }
    },
    [prompts],
  )

  // Reset focused index when filtered prompts change
  useEffect(() => {
    setFocusedIndex(-1)
  }, [searchQuery, activeTab])

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      // Check if any input is focused
      const target = e.target as HTMLElement
      const isInputFocused
        = target.tagName === 'INPUT'
          || target.tagName === 'TEXTAREA'
          || target.contentEditable === 'true'

      // Don't handle if input is focused or if modifiers are pressed
      if (isInputFocused || e.metaKey || e.ctrlKey || e.altKey) {
        return
      }

      const items = activeTab === 'prompts' ? filteredPrompts : savedPrompts

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
        if (activeTab === 'prompts') {
          const prompt = filteredPrompts[focusedIndex]
          if (prompt) {
            handlePromptSelect(prompt)
          }
        }
        else {
          const prompt = savedPrompts[focusedIndex]
          if (prompt) {
            loadSavedPrompt(prompt)
          }
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [
    focusedIndex,
    filteredPrompts,
    savedPrompts,
    activeTab,
    handlePromptSelect,
    loadSavedPrompt,
  ])

  // Scroll focused item into view
  useEffect(() => {
    if (focusedIndex >= 0) {
      const itemId
        = activeTab === 'prompts'
          ? `prompt-${filteredPrompts[focusedIndex]?.name}`
          : `saved-prompt-${savedPrompts[focusedIndex]?.id}`
      const element = document.getElementById(itemId)
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    }
  }, [focusedIndex, filteredPrompts, savedPrompts, activeTab])

  // Handle auto-selection from context
  useEffect(() => {
    console.warn('[PromptsTab] Auto-selection effect triggered:', {
      selectedPromptName,
      promptsCount: prompts.length,
      currentSelectedPrompt: selectedPrompt?.name,
    })

    if (selectedPromptName && prompts.length > 0) {
      const prompt = prompts.find(p => p.name === selectedPromptName)
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
        const timeoutId = setTimeout(() => {
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

        return () => clearTimeout(timeoutId)
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
    setPromptArgs(prev => ({ ...prev, [key]: value }))
  }, [])

  const executePrompt = useCallback(async () => {
    if (!selectedPrompt || isExecuting)
      return

    setIsExecuting(true)
    const startTime = Date.now()

    try {
      const result = await callPrompt(selectedPrompt.name, promptArgs)
      const duration = Date.now() - startTime

      // Track successful prompt call
      const telemetry = Telemetry.getInstance()
      telemetry
        .capture(
          new MCPPromptCallEvent({
            promptName: selectedPrompt.name,
            serverId,
            success: true,
          }),
        )
        .catch(() => {
          // Silently fail - telemetry should not break the application
        })

      setResults(prev => [
        {
          promptName: selectedPrompt.name,
          args: promptArgs,
          result,
          timestamp: startTime,
          duration,
        },
        ...prev,
      ])
    }
    catch (error) {
      // Track failed prompt call
      const telemetry = Telemetry.getInstance()
      telemetry
        .capture(
          new MCPPromptCallEvent({
            promptName: selectedPrompt.name,
            serverId,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          }),
        )
        .catch(() => {
          // Silently fail - telemetry should not break the application
        })

      const errorResult = {
        promptName: selectedPrompt.name,
        args: promptArgs,
        result: null,
        error: error instanceof Error ? error.message : String(error),
        timestamp: startTime,
        duration: Date.now() - startTime,
      }

      setResults(prev => [errorResult, ...prev])
    }
    finally {
      setIsExecuting(false)
    }
  }, [selectedPrompt, promptArgs, isExecuting, callPrompt, serverId])

  const handleCopyResult = useCallback(async (index: number, result: any) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(result, null, 2))
      setCopiedResult(index)
      setTimeout(() => setCopiedResult(null), 2000)
    }
    catch (error) {
      console.error('[PromptsTab] Failed to copy result:', error)
    }
  }, [])

  const openSaveDialog = useCallback(() => {
    if (!selectedPrompt)
      return
    setPromptName('')
    setSaveDialogOpen(true)
  }, [selectedPrompt])

  const deleteSavedPrompt = useCallback(
    (id: string) => {
      saveSavedPrompts(savedPrompts.filter(p => p.id !== id))
      // Clear selection if the deleted prompt was selected
      if (selectedSavedPrompt?.id === id) {
        setSelectedSavedPrompt(null)
      }
    },
    [savedPrompts, saveSavedPrompts, selectedSavedPrompt],
  )

  return (
    <ResizablePanelGroup direction="horizontal" className="h-full">
      <ResizablePanel
        defaultSize={33}
        className="flex flex-col h-full relative"
      >
        <PromptsTabHeader
          activeTab={activeTab}
          isSearchExpanded={isSearchExpanded}
          searchQuery={searchQuery}
          filteredPromptsCount={filteredPrompts.length}
          savedPromptsCount={savedPrompts.length}
          onSearchExpand={() => setIsSearchExpanded(true)}
          onSearchChange={setSearchQuery}
          onSearchBlur={handleSearchBlur}
          onTabSwitch={() =>
            setActiveTab(activeTab === 'prompts' ? 'saved' : 'prompts')}
          searchInputRef={searchInputRef as React.RefObject<HTMLInputElement>}
        />

        {activeTab === 'prompts'
          ? (
              <PromptsList
                prompts={filteredPrompts}
                selectedPrompt={selectedPrompt}
                onPromptSelect={handlePromptSelect}
                focusedIndex={focusedIndex}
              />
            )
          : (
              <SavedPromptsList
                savedPrompts={savedPrompts}
                selectedPrompt={selectedSavedPrompt}
                onLoadPrompt={loadSavedPrompt}
                onDeletePrompt={deleteSavedPrompt}
                focusedIndex={focusedIndex}
              />
            )}
      </ResizablePanel>

      <ResizableHandle withHandle />

      <ResizablePanel defaultSize={67}>
        <ResizablePanelGroup direction="vertical">
          <ResizablePanel defaultSize={40}>
            <PromptExecutionPanel
              selectedPrompt={selectedPrompt}
              promptArgs={promptArgs}
              isExecuting={isExecuting}
              isConnected={isConnected}
              onArgChange={handleArgChange}
              onExecute={executePrompt}
              onSave={openSaveDialog}
            />
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={60}>
            <div className="flex flex-col h-full">
              <PromptResultDisplay
                results={results}
                copiedResult={copiedResult}
                onCopy={handleCopyResult}
              />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

PromptsTab.displayName = 'PromptsTab'
