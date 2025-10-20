import { memo, useEffect, useRef } from 'react'
import { TextShimmer } from '@/client/components/ui/text-shimmer'
import { AssistantMessage } from './AssistantMessage'
import { ToolCallDisplay } from './ToolCallDisplay'
import { ToolResultRenderer } from './ToolResultRenderer'
import { UserMessage } from './UserMessage'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string | Array<{ index: number, type: string, text: string }>
  timestamp: number
  parts?: Array<{
    type: 'text' | 'tool-invocation'
    text?: string
    toolInvocation?: {
      toolName: string
      args: Record<string, unknown>
      result?: any
      state?: 'pending' | 'result' | 'error'
    }
  }>
  toolCalls?: Array<{
    toolName: string
    args: Record<string, unknown>
    result?: any
  }>
}

interface MessageListProps {
  messages: Message[]
  isLoading: boolean
  serverId?: string
  readResource?: (uri: string) => Promise<any>
}

export const MessageList = memo(({ messages, isLoading, serverId, readResource }: MessageListProps) => {
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Scroll to bottom when messages change or streaming status changes
  useEffect(() => {
    if (messages.length > 0 && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({
        behavior: !isLoading ? 'smooth' : 'auto',
        block: 'start',
      })
    }
  }, [messages.length, isLoading])

  // Determine if we're in "thinking" state vs "streaming" state
  const isThinking = isLoading
    && (() => {
      if (messages.length === 0)
        return true

      const lastMessage = messages[messages.length - 1]
      // If last message is from user, we're thinking
      if (lastMessage.role === 'user')
        return true

      // If last message is from assistant but empty/minimal content, we're thinking
      if (lastMessage.role === 'assistant') {
        const contentStr
          = typeof lastMessage.content === 'string'
            ? lastMessage.content
            : Array.isArray(lastMessage.content)
              ? lastMessage.content
                  .map(item =>
                    typeof item === 'string'
                      ? item
                      : item.text || JSON.stringify(item),
                  )
                  .join('')
              : JSON.stringify(lastMessage.content)

        const hasContent = contentStr && contentStr.trim().length > 0
        return !hasContent
      }

      return false
    })()

  // Determine if a message is currently streaming
  const isMessageStreaming = (message: Message) => {
    if (!isLoading)
      return false

    // If this is the last message and it's from assistant, it's streaming
    const lastMessage = messages[messages.length - 1]
    return message.id === lastMessage.id && lastMessage.role === 'assistant'
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto px-2">
      {messages.map((message) => {
        const contentStr
          = typeof message.content === 'string'
            ? message.content
            : Array.isArray(message.content)
              ? message.content
                  .map(item =>
                    typeof item === 'string'
                      ? item
                      : item.text || JSON.stringify(item),
                  )
                  .join('')
              : JSON.stringify(message.content)

        if (message.role === 'user') {
          return (
            <UserMessage
              key={message.id}
              content={contentStr}
              timestamp={message.timestamp}
            />
          )
        }

        if (message.role === 'assistant') {
          return (
            <div key={message.id} className="space-y-4">
              {/* Handle message parts if available (for proper ordering) */}
              {message.parts && message.parts.length > 0
                ? message.parts.map((part, partIndex) => {
                    const partKey = part.type === 'text'
                      ? `${message.id}-text-${partIndex}-${part.text?.slice(0, 20)}`
                      : `${message.id}-tool-${part.toolInvocation?.toolName}-${partIndex}`

                    if (part.type === 'text') {
                      return (
                        <AssistantMessage
                          key={partKey}
                          content={part.text || ''}
                          timestamp={
                            partIndex === message.parts!.length - 1
                              ? message.timestamp
                              : undefined
                          }
                          _isStreaming={isMessageStreaming(message)}
                        />
                      )
                    }
                    else if (part.type === 'tool-invocation' && part.toolInvocation) {
                      return (
                        <div key={partKey}>
                          <ToolCallDisplay
                            toolName={part.toolInvocation.toolName}
                            args={part.toolInvocation.args}
                            result={part.toolInvocation.result}
                            state={part.toolInvocation.result ? 'result' : 'call'}
                          />
                          {/* Render tool result (OpenAI Apps SDK or MCP-UI resources) */}
                          {part.toolInvocation.result && (
                            <ToolResultRenderer
                              toolName={part.toolInvocation.toolName}
                              toolArgs={part.toolInvocation.args}
                              result={part.toolInvocation.result}
                              serverId={serverId}
                              readResource={readResource}
                            />
                          )}
                        </div>
                      )
                    }
                    return null
                  })
                : (
                    <>
                      <AssistantMessage
                        content={contentStr}
                        timestamp={message.timestamp}
                        _isStreaming={isMessageStreaming(message)}
                      />

                      {/* Tool Calls (fallback for non-parts messages) */}
                      {message.toolCalls && message.toolCalls.length > 0 && (
                        <div className="space-y-2">
                          {message.toolCalls.map((toolCall) => {
                            const toolCallKey = `${message.id}-${toolCall.toolName}-${JSON.stringify(toolCall.args).slice(0, 50)}`

                            return (
                              <div key={toolCallKey}>
                                <ToolCallDisplay
                                  toolName={toolCall.toolName}
                                  args={toolCall.args}
                                  result={toolCall.result}
                                  state={toolCall.result ? 'result' : 'call'}
                                />
                                {/* Render tool result (OpenAI Apps SDK or MCP-UI resources) */}
                                {toolCall.result && (
                                  <ToolResultRenderer
                                    toolName={toolCall.toolName}
                                    toolArgs={toolCall.args}
                                    result={toolCall.result}
                                    serverId={serverId}
                                    readResource={readResource}
                                  />
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </>
                  )}
            </div>
          )
        }

        return null
      })}

      {/* Thinking indicator - only show when actually thinking, not streaming */}
      {isThinking && (
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <div className="rounded-lg p-4 max-w-fit">
              <div className="flex items-center gap-2">
                <span className="text-sm">
                  <TextShimmer duration={2} spread={1}>
                    Thinking...
                  </TextShimmer>
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reference for scrolling to bottom */}
      <div ref={messagesEndRef} />
    </div>
  )
})
