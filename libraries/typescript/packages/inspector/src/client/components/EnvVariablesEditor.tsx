'use client'

import { Eye, EyeOff, FileText, Plus, Trash2 } from 'lucide-react'
import React, { useCallback, useRef, useState } from 'react'
import { Button } from '@/client/components/ui/button'
import { Input } from '@/client/components/ui/input'
import { Label } from '@/client/components/ui/label'
import { cn } from '@/lib/utils'

export interface EnvVariable {
  key: string
  value: string
  id: string
}

export interface EnvVariablesEditorProps {
  variables: EnvVariable[]
  onChange: (variables: EnvVariable[]) => void
  onSave?: () => void
  className?: string
  title?: string
  description?: string
  showImportSection?: boolean
  maxVariables?: number
}

export function EnvVariablesEditor({
  variables,
  onChange,
  onSave,
  className,
  title = 'Environment Variables',
  description = 'Define environment variables for your application',
  showImportSection = true,
  maxVariables = 100,
}: EnvVariablesEditorProps) {
  const [showValues, setShowValues] = useState<Record<string, boolean>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Generate unique ID for new variables
  const generateId = () => Math.random().toString(36).slice(2, 11)

  // Parse .env content and extract key-value pairs
  const parseEnvContent = useCallback((content: string): EnvVariable[] => {
    const lines = content.split('\n')
    const parsed: EnvVariable[] = []

    for (const line of lines) {
      const trimmed = line.trim()

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) {
        continue
      }

      // Handle different .env formats
      const equalIndex = trimmed.indexOf('=')
      if (equalIndex === -1)
        continue

      const key = trimmed.substring(0, equalIndex).trim()
      let value = trimmed.substring(equalIndex + 1).trim()

      // Remove quotes if present
      if (
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith('\'') && value.endsWith('\''))
      ) {
        value = value.slice(1, -1)
      }

      // Skip if key is empty
      if (!key)
        continue

      parsed.push({
        id: generateId(),
        key,
        value,
      })
    }

    return parsed
  }, [])

  // Add new variable
  const addVariable = () => {
    if (variables.length >= maxVariables)
      return

    const newVariable: EnvVariable = {
      id: generateId(),
      key: '',
      value: '',
    }
    onChange([...variables, newVariable])
  }

  // Remove variable
  const removeVariable = (id: string) => {
    onChange(variables.filter(v => v.id !== id))
  }

  // Update variable
  const updateVariable = (
    id: string,
    field: 'key' | 'value',
    value: string,
  ) => {
    onChange(
      variables.map(v => (v.id === id ? { ...v, [field]: value } : v)),
    )
  }

  // Toggle value visibility
  const toggleValueVisibility = (id: string) => {
    setShowValues(prev => ({
      ...prev,
      [id]: !prev[id],
    }))
  }

  // Handle paste in input fields
  const handlePaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    const pastedText = event.clipboardData.getData('text')

    // Check if the pasted content looks like .env format (contains = and multiple lines)
    if (
      pastedText.includes('=')
      && (pastedText.includes('\n') || pastedText.includes('\r'))
    ) {
      event.preventDefault()

      const parsed = parseEnvContent(pastedText)
      if (parsed.length > 0) {
        // Merge with existing variables, avoiding duplicates
        const existingKeys = new Set(variables.map(v => v.key))
        const newVariables = parsed.filter(v => !existingKeys.has(v.key))

        if (newVariables.length > 0) {
          onChange([...variables, ...newVariables])
        }
      }
    }
  }

  // Handle file import
  const handleFileImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file)
      return

    const reader = new FileReader()
    reader.onload = (e) => {
      const content = e.target?.result as string
      const parsed = parseEnvContent(content)

      if (parsed.length > 0) {
        // Merge with existing variables, avoiding duplicates
        const existingKeys = new Set(variables.map(v => v.key))
        const newVariables = parsed.filter(v => !existingKeys.has(v.key))

        if (newVariables.length > 0) {
          onChange([...variables, ...newVariables])
        }
      }
    }
    reader.readAsText(file)
  }

  return (
    <div className={cn('space-y-3', className)}>
      {/* Header */}
      <div className="space-y-2">
        <Label className="text-base font-medium">{title}</Label>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      {/* Variables Table */}
      <div className="space-y-2">
        {/* Table Header */}
        <div className="grid grid-cols-2 gap-4 text-sm font-medium text-muted-foreground">
          <div>Key</div>
          <div>Value</div>
        </div>

        {/* Variables */}
        {variables.length === 0
          ? (
              <div className="grid grid-cols-2 gap-4 items-center">
                <Input
                  placeholder="CLIENT_KEY..."
                  value=""
                  onChange={() => {}}
                  onPaste={handlePaste}
                  className="font-mono text-sm"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck="false"
                />
                <div className="flex items-center gap-2">
                  <Input
                    placeholder=""
                    value=""
                    onChange={() => {}}
                    onPaste={handlePaste}
                    className="font-mono text-sm"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck="false"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="h-8 w-8 p-0"
                    disabled
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="h-8 w-8 p-0"
                    disabled
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )
          : (
              variables.map(variable => (
                <div
                  key={variable.id}
                  className="grid grid-cols-2 gap-4 items-center"
                >
                  <Input
                    placeholder="CLIENT_KEY..."
                    value={variable.key}
                    onChange={e =>
                      updateVariable(variable.id, 'key', e.target.value)}
                    onPaste={handlePaste}
                    className="font-mono text-sm"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck="false"
                  />
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder=""
                      value={variable.value}
                      onChange={e =>
                        updateVariable(variable.id, 'value', e.target.value)}
                      onPaste={handlePaste}
                      type={showValues[variable.id] ? 'text' : 'password'}
                      className="font-mono text-sm"
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck="false"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => toggleValueVisibility(variable.id)}
                      className="h-8 w-8 p-0"
                    >
                      {showValues[variable.id]
                        ? (
                            <EyeOff className="h-4 w-4" />
                          )
                        : (
                            <Eye className="h-4 w-4" />
                          )}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => removeVariable(variable.id)}
                      className="h-8 w-8 p-0"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))
            )}

        {/* Add Another Button */}
        <div className="flex justify-start gap-3 items-center mt-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addVariable}
            disabled={variables.length >= maxVariables}
            className="flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Add Another
          </Button>
          {showImportSection && (
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2"
              >
                <FileText className="h-4 w-4" />
                Import .env
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".env,.env.local,.env.production,.env.development"
                onChange={handleFileImport}
                className="hidden"
                aria-label="Import .env file"
                title="Import .env file"
              />
              <span className="text-sm text-muted-foreground">
                or paste the .env contents above
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Save Button */}
      {onSave && (
        <div className="flex justify-end">
          <Button
            type="button"
            onClick={onSave}
            className="bg-black text-white hover:bg-gray-800"
          >
            Save
          </Button>
        </div>
      )}
    </div>
  )
}
