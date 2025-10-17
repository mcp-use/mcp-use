import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { Play, Save } from 'lucide-react'
import { ToolInputForm } from './ToolInputForm'

interface ToolExecutionPanelProps {
  selectedTool: Tool | null
  toolArgs: Record<string, unknown>
  isExecuting: boolean
  isConnected: boolean
  onArgChange: (key: string, value: string) => void
  onExecute: () => void
  onSave: () => void
}

export function ToolExecutionPanel({
  selectedTool,
  toolArgs,
  isExecuting,
  isConnected,
  onArgChange,
  onExecute,
  onSave,
}: ToolExecutionPanelProps) {
  if (!selectedTool) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center">
        <p className="text-gray-500 dark:text-gray-400 mb-2">
          Select a tool to get started
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Choose a tool from the list to view its details and execute it
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 p-7 pb-4 space-y-4">
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              {selectedTool.name}
            </h2>
          </div>
          {selectedTool.description && (
            <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
              {selectedTool.description}
            </p>
          )}
        </div>

        <ToolInputForm
          selectedTool={selectedTool}
          toolArgs={toolArgs}
          onArgChange={onArgChange}
        />

        <div className="flex gap-2">
          <Button
            onClick={onExecute}
            disabled={isExecuting || !isConnected}
            className="flex-1"
          >
            {isExecuting ? (
              <>
                <Spinner size="sm" className="mr-2" />
                Executing...
              </>
            ) : (
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
    </div>
  )
}
