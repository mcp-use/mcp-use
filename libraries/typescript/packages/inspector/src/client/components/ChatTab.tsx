import React, { useCallback, useEffect, useRef, useState } from 'react'

import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { ChatHeader } from './chat/ChatHeader'
import { ChatInputArea } from './chat/ChatInputArea'
import { ChatLandingForm } from './chat/ChatLandingForm'
import { ConfigurationDialog } from './chat/ConfigurationDialog'
import { ConfigureEmptyState } from './chat/ConfigureEmptyState'
import { MessageList } from './chat/MessageList'
import { useChatMessages } from './chat/useChatMessages'
import { useConfig } from './chat/useConfig'

interface ChatTabProps {
  mcpServerUrl: string
  isConnected: boolean
  // OAuth state from the main Inspector connection
  oauthState?: 'ready' | 'authenticating' | 'failed' | 'pending_auth'
  oauthError?: string
}

export function ChatTab({
  mcpServerUrl,
  isConnected,
  oauthState: _oauthState,
  oauthError: _oauthError,
}: ChatTabProps) {
  const [inputValue, setInputValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  // Use custom hooks for configuration and chat messages
  const {
    llmConfig,
    authConfig,
    configDialogOpen,
    setConfigDialogOpen,
    tempProvider,
    setTempProvider,
    tempApiKey,
    setTempApiKey,
    tempModel,
    setTempModel,
    saveLLMConfig,
    clearConfig,
  } = useConfig({ mcpServerUrl })

  const { messages, isLoading, sendMessage, clearMessages } = useChatMessages({
    mcpServerUrl,
    llmConfig,
    authConfig,
    isConnected,
  })

  // Register keyboard shortcuts (only active when ChatTab is mounted)
  useKeyboardShortcuts({
    onNewChat: clearMessages,
  })

  // Focus the textarea when landing form is shown
  useEffect(() => {
    if (llmConfig && messages.length === 0 && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [llmConfig, messages.length])

  // Auto-refocus the textarea after streaming completes
  useEffect(() => {
    if (!isLoading && messages.length > 0 && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [isLoading, messages.length])

  const handleSendMessage = useCallback(() => {
    if (!inputValue.trim()) {
      return
    }
    sendMessage(inputValue)
    setInputValue('')
  }, [inputValue, sendMessage])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSendMessage()
      }
    },
    [handleSendMessage],
  )

  const handleClearConfig = useCallback(() => {
    clearConfig()
    clearMessages()
  }, [clearConfig, clearMessages])

  // Show landing form when there are no messages and LLM is configured
  if (llmConfig && messages.length === 0) {
    return (
      <div className="flex flex-col h-full">
        {/* Header with config dialog */}
        <div className="absolute top-4 right-4 z-10">
          <ConfigurationDialog
            open={configDialogOpen}
            onOpenChange={setConfigDialogOpen}
            tempProvider={tempProvider}
            tempModel={tempModel}
            tempApiKey={tempApiKey}
            onProviderChange={setTempProvider}
            onModelChange={setTempModel}
            onApiKeyChange={setTempApiKey}
            onSave={saveLLMConfig}
            onClear={handleClearConfig}
            showClearButton
            buttonLabel="Change API Key"
          />
        </div>

        {/* Landing Form */}
        <ChatLandingForm
          mcpServerUrl={mcpServerUrl}
          inputValue={inputValue}
          isConnected={isConnected}
          isLoading={isLoading}
          textareaRef={textareaRef}
          llmConfig={llmConfig}
          onInputChange={setInputValue}
          onKeyDown={handleKeyDown}
          onSubmit={(e) => {
            e.preventDefault()
            handleSendMessage()
          }}
          onConfigDialogOpenChange={setConfigDialogOpen}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full relative">
      {/* Header */}
      <ChatHeader
        llmConfig={llmConfig}
        hasMessages={messages.length > 0}
        configDialogOpen={configDialogOpen}
        onConfigDialogOpenChange={setConfigDialogOpen}
        onClearChat={clearMessages}
        tempProvider={tempProvider}
        tempModel={tempModel}
        tempApiKey={tempApiKey}
        onProviderChange={setTempProvider}
        onModelChange={setTempModel}
        onApiKeyChange={setTempApiKey}
        onSaveConfig={saveLLMConfig}
        onClearConfig={handleClearConfig}
      />

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 pt-[100px]">
        {!llmConfig
          ? (
              <ConfigureEmptyState
                onConfigureClick={() => setConfigDialogOpen(true)}
              />
            )
          : (
              <MessageList messages={messages} isLoading={isLoading} />
            )}
      </div>

      {/* Input Area */}
      {llmConfig && (
        <ChatInputArea
          inputValue={inputValue}
          isConnected={isConnected}
          isLoading={isLoading}
          textareaRef={textareaRef}
          onInputChange={setInputValue}
          onKeyDown={handleKeyDown}
          onSendMessage={handleSendMessage}
        />
      )}
    </div>
  )
}
