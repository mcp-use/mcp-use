import type { LLMConfig } from './types'

import { Badge } from '@/client/components/ui/badge'
import { Button } from '@/client/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/client/components/ui/tooltip'
import { ConfigurationDialog } from './ConfigurationDialog'

interface ChatHeaderProps {
  llmConfig: LLMConfig | null
  hasMessages: boolean
  configDialogOpen: boolean
  onConfigDialogOpenChange: (open: boolean) => void
  onClearChat: () => void
  // Configuration props
  tempProvider: 'openai' | 'anthropic' | 'google'
  tempModel: string
  tempApiKey: string
  onProviderChange: (provider: 'openai' | 'anthropic' | 'google') => void
  onModelChange: (model: string) => void
  onApiKeyChange: (apiKey: string) => void
  onSaveConfig: () => void
  onClearConfig: () => void
}

export function ChatHeader({
  llmConfig,
  hasMessages,
  configDialogOpen,
  onConfigDialogOpenChange,
  onClearChat,
  tempProvider,
  tempModel,
  tempApiKey,
  onProviderChange,
  onModelChange,
  onApiKeyChange,
  onSaveConfig,
  onClearConfig,
}: ChatHeaderProps) {
  return (
    <div className="flex absolute top-0 right-0 z-10 w-full items-center justify-between p-1 pt-2">
      <div className="flex items-center gap-2 bg-background/70 backdrop-blur-sm rounded-full p-2 px-4">
        <h3 className="text-3xl font-base">Chat</h3>
        {llmConfig && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="secondary"
                className="ml-2 pl-1 font-mono text-[11px] cursor-pointer hover:bg-secondary/80 transition-colors"
                onClick={() => onConfigDialogOpenChange(true)}
              >
                <img
                  src={`/inspector/providers/${llmConfig.provider}.png`}
                  alt={llmConfig.provider}
                  className="w-4 h-4 mr-0"
                />
                {llmConfig.provider}/{llmConfig.model}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>Change API Key</p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="flex items-center gap-2 pr-3 pt-2">
        {hasMessages && (
          <Button size="default" className="pr-1 cursor-pointer" onClick={onClearChat}>
            New Chat
            <span className="text-[12px]  border text-zinc-300 p-1 rounded-full border-zinc-300 dark:text-zinc-600 dark:border-zinc-500">
              ⌘O
            </span>
          </Button>
        )}
        <ConfigurationDialog
          open={configDialogOpen}
          onOpenChange={onConfigDialogOpenChange}
          tempProvider={tempProvider}
          tempModel={tempModel}
          tempApiKey={tempApiKey}
          onProviderChange={onProviderChange}
          onModelChange={onModelChange}
          onApiKeyChange={onApiKeyChange}
          onSave={onSaveConfig}
          onClear={onClearConfig}
          showClearButton={!!llmConfig}
          buttonLabel={llmConfig ? 'Change API Key' : 'Configure API Key'}
        />
      </div>
    </div>
  )
}
