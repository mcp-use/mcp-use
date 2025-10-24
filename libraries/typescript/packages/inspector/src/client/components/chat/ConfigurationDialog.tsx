import { Key } from 'lucide-react'
import React from 'react'

import { Button } from '@/client/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/client/components/ui/dialog'
import { Input } from '@/client/components/ui/input'
import { Label } from '@/client/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/client/components/ui/select'

interface ConfigurationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tempProvider: 'openai' | 'anthropic' | 'google'
  tempModel: string
  tempApiKey: string
  onProviderChange: (provider: 'openai' | 'anthropic' | 'google') => void
  onModelChange: (model: string) => void
  onApiKeyChange: (apiKey: string) => void
  onSave: () => void
  onClear?: () => void
  showClearButton?: boolean
  buttonLabel?: string
}

export function ConfigurationDialog({
  open,
  onOpenChange,
  tempProvider,
  tempModel,
  tempApiKey,
  onProviderChange,
  onModelChange,
  onApiKeyChange,
  onSave,
  onClear,
  showClearButton = false,
  buttonLabel = 'Configure API Key',
}: ConfigurationDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>LLM Provider Configuration</DialogTitle>
          <DialogDescription>
            Configure your LLM provider and API key to start chatting with
            the MCP server
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Provider</Label>
            <Select
              value={tempProvider}
              onValueChange={(v: any) => onProviderChange(v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="anthropic">Anthropic</SelectItem>
                <SelectItem value="google">Google</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Model</Label>
            <Input
              value={tempModel}
              onChange={e => onModelChange(e.target.value)}
              placeholder="e.g., gpt-4o"
            />
          </div>

          <div className="space-y-2">
            <Label>API Key</Label>
            <div className="flex gap-2">
              <Input
                type="password"
                value={tempApiKey}
                onChange={e => onApiKeyChange(e.target.value)}
                placeholder="Enter your API key"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Your API key is stored locally and never sent to our servers
            </p>
          </div>

          <div className="flex justify-between">
            {showClearButton && onClear && (
              <Button variant="outline" onClick={onClear}>
                Clear Config
              </Button>
            )}
            <Button
              onClick={onSave}
              disabled={!tempApiKey.trim()}
              className={showClearButton ? 'ml-auto' : ''}
            >
              <Key className="h-4 w-4 mr-2" />
              Save Configuration
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
