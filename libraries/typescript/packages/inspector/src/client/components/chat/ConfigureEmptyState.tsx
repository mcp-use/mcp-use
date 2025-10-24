import { Key, Settings } from 'lucide-react'
import React from 'react'

import { Button } from '@/client/components/ui/button'

interface ConfigureEmptyStateProps {
  onConfigureClick: () => void
}

export function ConfigureEmptyState({ onConfigureClick }: ConfigureEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center">
      <Key className="h-12 w-12 text-muted-foreground mb-4" />
      <h3 className="text-lg font-semibold mb-2">
        Configure Your LLM Provider
      </h3>
      <p className="text-sm text-muted-foreground mb-4 max-w-md">
        To start chatting with the MCP server, you need to configure
        your LLM provider and API key. Your credentials are stored
        locally and used only for this chat.
      </p>
      <Button onClick={onConfigureClick}>
        <Settings className="h-4 w-4 mr-2" />
        Configure API Key
      </Button>
    </div>
  )
}
