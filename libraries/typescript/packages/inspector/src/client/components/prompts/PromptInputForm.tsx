import type { Prompt } from '@modelcontextprotocol/sdk/types.js'
import { Input } from '@/client/components/ui/input'
import { Label } from '@/client/components/ui/label'
import { Textarea } from '@/client/components/ui/textarea'

interface PromptInputFormProps {
  selectedPrompt: Prompt
  promptArgs: Record<string, unknown>
  onArgChange: (key: string, value: any) => void
}

export function PromptInputForm({
  selectedPrompt,
  promptArgs,
  onArgChange,
}: PromptInputFormProps) {
  const arguments_ = selectedPrompt?.arguments || []
  const hasInputs = arguments_.length > 0

  if (!hasInputs) {
    return (
      <div className="flex items-center justify-center h-32 text-gray-500 dark:text-gray-400 text-sm">
        No arguments required
      </div>
    )
  }

  const renderInputField = (arg: any) => {
    const key = arg.name
    const value = promptArgs[key]
    const stringValue
      = typeof value === 'string' ? value : JSON.stringify(value)

    if (arg.type === 'boolean') {
      return (
        <div key={key} className="space-y-2">
          <Label htmlFor={key} className="text-sm font-medium">
            {key}
            {arg.required && <span className="text-red-500 ml-1">*</span>}
          </Label>
          <div className="flex items-center space-x-2">
            <input
              id={key}
              type="checkbox"
              checked={Boolean(value)}
              onChange={e => onArgChange(key, e.target.checked)}
              className="rounded"
              aria-label={`Toggle ${key}`}
            />
            <span className="text-sm text-gray-600 dark:text-gray-400">{arg.description}</span>
          </div>
        </div>
      )
    }

    if (arg.type === 'number') {
      return (
        <div key={key} className="space-y-2">
          <Label htmlFor={key} className="text-sm font-medium">
            {key}
            {arg.required && <span className="text-red-500 ml-1">*</span>}
          </Label>
          <Input
            id={key}
            type="number"
            value={Number(value) || 0}
            onChange={e => onArgChange(key, Number(e.target.value))}
            placeholder={arg.description || `Enter ${key}`}
          />
          {arg.description && (
            <p className="text-xs text-gray-500 dark:text-gray-400">{arg.description}</p>
          )}
        </div>
      )
    }

    if (arg.type === 'array' || arg.type === 'object') {
      return (
        <div key={key} className="space-y-2">
          <Label htmlFor={key} className="text-sm font-medium">
            {key}
            {arg.required && <span className="text-red-500 ml-1">*</span>}
          </Label>
          <Textarea
            id={key}
            value={stringValue}
            onChange={(e) => {
              try {
                const parsed = JSON.parse(e.target.value)
                onArgChange(key, parsed)
              }
              catch {
                onArgChange(key, e.target.value)
              }
            }}
            placeholder={arg.description || `Enter ${key} as JSON`}
            className="font-mono text-sm min-h-[100px]"
          />
          {arg.description && (
            <p className="text-xs text-gray-500 dark:text-gray-400">{arg.description}</p>
          )}
        </div>
      )
    }

    return (
      <div key={key} className="space-y-2">
        <Label htmlFor={key} className="text-sm font-medium">
          {key}
          {arg.required && <span className="text-red-500 ml-1">*</span>}
        </Label>
        <Input
          id={key}
          value={stringValue}
          onChange={e => onArgChange(key, e.target.value)}
          placeholder={arg.description || `Enter ${key}`}
        />
        {arg.description && (
          <p className="text-xs text-gray-500 dark:text-gray-400">{arg.description}</p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {arguments_.map(arg => renderInputField(arg))}
    </div>
  )
}
