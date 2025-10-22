import type { Prompt } from '@modelcontextprotocol/sdk/types.js'
import { Play, Save } from 'lucide-react'
import { Button } from '@/client/components/ui/button'
import { Spinner } from '@/client/components/ui/spinner'
import { PromptInputForm } from './PromptInputForm'

interface PromptExecutionPanelProps {
  selectedPrompt: Prompt | null
  promptArgs: Record<string, unknown>
  isExecuting: boolean
  isConnected: boolean
  onArgChange: (key: string, value: any) => void
  onExecute: () => void
  onSave: () => void
}

export function PromptExecutionPanel({
  selectedPrompt,
  promptArgs,
  isExecuting,
  isConnected,
  onArgChange,
  onExecute,
  onSave,
}: PromptExecutionPanelProps) {
  if (!selectedPrompt) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center">
        <p className="text-gray-500 dark:text-gray-400 mb-2">
          Select a prompt to get started
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Choose a prompt from the list to view its details and execute it
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 p-6 pt-3 pb-4 pr-3">
        <div>
          <div className="flex items-center justify-between mb-0">
            <h3 className="text-lg font-semibold mb-2">{selectedPrompt.name}</h3>
            <div className="flex gap-2">
              <Button
                onClick={onExecute}
                disabled={isExecuting || !isConnected}
              >
                {isExecuting
                  ? (
                      <>
                        <Spinner className="mr-2" />
                        Executing...
                      </>
                    )
                  : (
                      <>
                        <Play className="h-4 w-4 mr-2" />
                        Execute
                      </>
                    )}
              </Button>
              <Button
                variant="outline"
                onClick={onSave}
                disabled={isExecuting}
                className="gap-2"
              >
                <Save className="h-4 w-4" />
                Save
              </Button>
            </div>
          </div>
          {selectedPrompt.description && (
            <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
              {selectedPrompt.description}
            </p>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-4 pr-3">
        <PromptInputForm
          selectedPrompt={selectedPrompt}
          promptArgs={promptArgs}
          onArgChange={onArgChange}
        />
      </div>
    </div>
  )
}
