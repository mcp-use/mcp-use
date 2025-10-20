import type { LLMConfig } from './types'
import { ArrowUp, Loader2 } from 'lucide-react'

import React from 'react'
import { AuroraBackground } from '@/client/components/ui/aurora-background'
import { Badge } from '@/client/components/ui/badge'
import { BlurFade } from '@/client/components/ui/blur-fade'
import { Button } from '@/client/components/ui/button'
import { Textarea } from '@/client/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/client/components/ui/tooltip'
import { cn } from '@/client/lib/utils'

interface ChatLandingFormProps {
  mcpServerUrl: string
  inputValue: string
  isConnected: boolean
  isLoading: boolean
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  llmConfig: LLMConfig | null
  onInputChange: (value: string) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onSubmit: (e: React.FormEvent) => void
  onConfigDialogOpenChange: (open: boolean) => void
}

export function ChatLandingForm({
  mcpServerUrl,
  inputValue,
  isConnected,
  isLoading,
  textareaRef,
  llmConfig,
  onInputChange,
  onKeyDown,
  onSubmit,
  onConfigDialogOpenChange,
}: ChatLandingFormProps) {
  return (
    <AuroraBackground>
      <BlurFade className="w-full max-w-4xl mx-auto px-4">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-light mb-2 dark:text-white">
            Chat with MCP Server
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 font-light">
            {mcpServerUrl}
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-6">
          <div className="flex justify-center">
            <div className="relative w-full max-w-2xl">
              <Textarea
                ref={textareaRef}
                value={inputValue}
                onChange={e => onInputChange(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={
                  isConnected
                    ? 'Ask a question or request an action...'
                    : 'Server not connected'
                }
                className="p-4 min-h-[150px] max-h-[300px] rounded-xl bg-white/80 dark:text-white dark:bg-black backdrop-blur-sm border-gray-200 dark:border-zinc-800"
                disabled={!isConnected || isLoading}
              />
              <div className="absolute left-0 p-3 bottom-0 w-full flex justify-end items-end">
                <Button
                  type="submit"
                  size="sm"
                  className={cn(
                    'h-10 w-10 rounded-full',
                    isLoading && 'animate-spin',
                    !inputValue.trim() && 'bg-zinc-400',
                  )}
                  disabled={isLoading || !inputValue.trim() || !isConnected}
                >
                  {isLoading
                    ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      )
                    : (
                        <ArrowUp className="h-4 w-4" />
                      )}
                </Button>
              </div>
            </div>
          </div>
          {llmConfig && (
            <div className="flex justify-center mt-4">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="secondary"
                    className="pl-1 font-mono text-[11px] cursor-pointer hover:bg-secondary/80 transition-colors"
                    onClick={() => onConfigDialogOpenChange(true)}
                  >
                    <img
                      src={`https://inspector-cdn.mcp-use.com/providers/${llmConfig.provider}.png`}
                      alt={llmConfig.provider}
                      className="w-4 h-4 mr-0 rounded-full"
                    />
                    {llmConfig.provider}
                    /
                    {llmConfig.model}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Change API Key</p>
                </TooltipContent>
              </Tooltip>
            </div>
          )}
        </form>
      </BlurFade>
    </AuroraBackground>
  )
}
