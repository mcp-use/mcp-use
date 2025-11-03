import type { LLMConfig, Message } from './types'
import type { MCPConnection } from '@/client/context/McpContext'
import { useCallback, useRef, useState } from 'react'
import { MCPChatMessageEvent, Telemetry } from '@/client/telemetry'

interface UseChatMessagesClientSideProps {
  connection: MCPConnection
  llmConfig: LLMConfig | null
  isConnected: boolean
  readResource?: (uri: string) => Promise<any>
}

export function useChatMessagesClientSide({
  connection,
  llmConfig,
  isConnected,
  readResource,
}: UseChatMessagesClientSideProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const agentRef = useRef<any>(null)
  const llmRef = useRef<any>(null)

  const sendMessage = useCallback(
    async (userInput: string) => {
      if (!userInput.trim() || !llmConfig || !isConnected) {
        return
      }

      const userMessage: Message = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: userInput.trim(),
        timestamp: Date.now(),
      }

      setMessages(prev => [...prev, userMessage])
      setIsLoading(true)

      // Create abort controller for cancellation
      abortControllerRef.current = new AbortController()

      // Track telemetry
      const startTime = Date.now()
      let toolCallsCount = 0

      try {
        // Create assistant message that will be updated with streaming content
        const assistantMessageId = `assistant-${Date.now()}`
        let currentTextPart = ''
        const parts: Array<{
          type: 'text' | 'tool-invocation'
          text?: string
          toolInvocation?: {
            toolName: string
            args: Record<string, unknown>
            result?: any
            state?: string
          }
        }> = []

        // Add empty assistant message to start
        setMessages(prev => [
          ...prev,
          {
            id: assistantMessageId,
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
            parts: [],
          },
        ])

        // Create LLM instance from config (reuse if config hasn't changed)
        if (!llmRef.current ||
          llmRef.current.provider !== llmConfig.provider ||
          llmRef.current.model !== llmConfig.model ||
          llmRef.current.apiKey !== llmConfig.apiKey) {

          let llm: any
          if (llmConfig.provider === 'openai') {
            const { ChatOpenAI } = await import('@langchain/openai')
            llm = new ChatOpenAI({
              model: llmConfig.model,
              apiKey: llmConfig.apiKey,
              temperature: llmConfig.temperature ?? 0.7,
            })
          } else if (llmConfig.provider === 'anthropic') {
            const { ChatAnthropic } = await import('@langchain/anthropic')
            llm = new ChatAnthropic({
              model: llmConfig.model,
              apiKey: llmConfig.apiKey,
              temperature: llmConfig.temperature ?? 0.7,
            })
          } else if (llmConfig.provider === 'google') {
            const { ChatGoogleGenerativeAI } = await import('@langchain/google-genai')
            llm = new ChatGoogleGenerativeAI({
              model: llmConfig.model,
              apiKey: llmConfig.apiKey,
              temperature: llmConfig.temperature ?? 0.7,
            })
          } else {
            throw new Error(`Unsupported LLM provider: ${llmConfig.provider}`)
          }

          llmRef.current = {
            instance: llm,
            provider: llmConfig.provider,
            model: llmConfig.model,
            apiKey: llmConfig.apiKey,
          }
        }

        // Create or reuse agent
        if (!agentRef.current || agentRef.current.llm !== llmRef.current.instance) {
          // Dynamic import from browser export to avoid bundling server-side code
          const { MCPAgent } = await import('mcp-use/browser')

          agentRef.current = new MCPAgent({
            llm: llmRef.current.instance,
            client: connection.client,
            memoryEnabled: true,
            systemPrompt: 'You are a helpful assistant with access to MCP tools, prompts, and resources. Help users interact with the MCP server.',
          })
          await agentRef.current.initialize()
        } else {
          console.log('[useChatMessagesClientSide] Reusing existing agent. History length:', agentRef.current.conversationHistory?.length)
        }

        // Stream events from agent
        for await (const event of agentRef.current.streamEvents(
          userInput,
          10,        // maxSteps
          false,     // manageConnector - don't manage, already connected
          undefined  // externalHistory - agent maintains its own with memoryEnabled
        )) {
          // Check for abort
          if (abortControllerRef.current?.signal.aborted) {
            break
          }

          // Handle text streaming
          if (event.event === 'on_chat_model_stream' && event.data?.chunk?.text) {
            const text = event.data.chunk.text
            if (typeof text === 'string' && text.length > 0) {
              currentTextPart += text

              // Update or add text part
              const lastPart = parts[parts.length - 1]
              if (lastPart && lastPart.type === 'text') {
                lastPart.text = currentTextPart
              }
              else {
                parts.push({
                  type: 'text',
                  text: currentTextPart,
                })
              }

              setMessages(prev =>
                prev.map(msg =>
                  msg.id === assistantMessageId
                    ? { ...msg, parts: [...parts] }
                    : msg,
                ),
              )
            }
          }
          // Handle tool start
          else if (event.event === 'on_tool_start') {
            if (currentTextPart) {
              currentTextPart = ''
            }

            // Extract args from event data - check multiple possible locations
            let args = {}
            if (event.data?.input) {
              args = event.data.input
            }
            else if (event.data?.tool_input) {
              args = event.data.tool_input
            }
            else if (event.data) {
              // Sometimes the args are directly in data
              args = event.data
            }

            console.log('[useChatMessagesClientSide] on_tool_start:', {
              toolName: event.name,
              eventData: event.data,
              extractedArgs: args,
            })
            // Count tool calls for telemetry
            toolCallsCount++

            parts.push({
              type: 'tool-invocation',
              toolInvocation: {
                toolName: event.name || 'unknown',
                args,
                state: 'pending',
              },
            })

            setMessages(prev =>
              prev.map(msg =>
                msg.id === assistantMessageId
                  ? { ...msg, parts: [...parts] }
                  : msg,
              ),
            )
          }
          // Handle tool end
          else if (event.event === 'on_tool_end') {
            const toolPart = parts.find(
              p =>
                p.type === 'tool-invocation'
                && p.toolInvocation?.toolName === event.name
                && !p.toolInvocation?.result,
            )

            console.log('[useChatMessagesClientSide] on_tool_end event:', {
              toolName: event.name,
              hasToolPart: !!toolPart,
              output: event.data?.output,
            })

            if (toolPart && toolPart.toolInvocation) {
              const result = event.data?.output
              toolPart.toolInvocation.result = result
              toolPart.toolInvocation.state = 'result'

              // Parse result to check for Apps SDK component in the result's _meta field
              let parsedResult = result
              if (typeof result === 'string') {
                try {
                  parsedResult = JSON.parse(result)
                }
                catch (error) {
                  console.warn('[useChatMessagesClientSide] Failed to parse result:', error)
                }
              }

              // Check result's _meta field for Apps SDK component
              const appsSdkUri = parsedResult?._meta?.['openai/outputTemplate']

              console.log('[useChatMessagesClientSide] Apps SDK check:', {
                toolName: event.name,
                hasParsedResult: !!parsedResult,
                hasMeta: !!parsedResult?._meta,
                appsSdkUri,
              })

              if (appsSdkUri && typeof appsSdkUri === 'string' && readResource) {
                // Fetch the resource in the background
                console.log('[useChatMessagesClientSide] Detected Apps SDK component, fetching resource:', appsSdkUri)
                  ; (async () => {
                    try {
                      // Use the readResource function passed from the inspector connection
                      const resourceData = await readResource(appsSdkUri)

                      console.log('[useChatMessagesClientSide] Resource fetched:', resourceData)

                      // Extract structured content from parsed result
                      let structuredContent = null
                      if (parsedResult?.structuredContent) {
                        structuredContent = parsedResult.structuredContent
                      }
                      else if (Array.isArray(parsedResult) && parsedResult[0]) {
                        const firstResult = parsedResult[0]
                        if (firstResult.output?.value?.structuredContent) {
                          structuredContent = firstResult.output.value.structuredContent
                        }
                        else if (firstResult.structuredContent) {
                          structuredContent = firstResult.structuredContent
                        }
                        else if (firstResult.output?.value) {
                          structuredContent = firstResult.output.value
                        }
                      }

                      // Fallback to entire parsed result
                      if (!structuredContent) {
                        structuredContent = parsedResult
                      }

                      // Add the fetched resource contents to the result's content array
                      if (resourceData?.contents && Array.isArray(resourceData.contents)) {
                        // Convert resource contents to MCP resource format
                        const mcpResources = resourceData.contents.map((content: any) => ({
                          type: 'resource',
                          resource: content,
                        }))

                        console.log('[useChatMessagesClientSide] Created MCP resources:', mcpResources)

                        // Update the tool result with the fetched resources
                        if (toolPart.toolInvocation) {
                          const updatedResult = {
                            ...parsedResult,
                            content: [
                              ...(parsedResult.content || []),
                              ...mcpResources,
                            ],
                            structuredContent,
                          }

                          console.log('[useChatMessagesClientSide] Updated result:', updatedResult)
                          // Store as JSON string to match the format
                          toolPart.toolInvocation.result = JSON.stringify(updatedResult)

                          setMessages(prev =>
                            prev.map(msg =>
                              msg.id === assistantMessageId
                                ? { ...msg, parts: [...parts] }
                                : msg,
                            ),
                          )

                          console.log('[useChatMessagesClientSide] Messages state updated with resource')
                        }
                      }
                      else {
                        console.warn('[useChatMessagesClientSide] No contents in resourceData:', resourceData)
                      }
                    }
                    catch (error) {
                      console.error('Failed to fetch Apps SDK resource:', error)
                    }
                  })()
              }

              setMessages(prev =>
                prev.map(msg =>
                  msg.id === assistantMessageId
                    ? { ...msg, parts: [...parts] }
                    : msg,
                ),
              )
            }
          }
        }

        // Final update
        setMessages(prev =>
          prev.map(msg =>
            msg.id === assistantMessageId
              ? {
                ...msg,
                parts: [...parts],
                content: '',
              }
              : msg,
          ),
        )

        // Track successful chat message
        if (llmConfig) {
          const telemetry = Telemetry.getInstance()
          telemetry
            .capture(
              new MCPChatMessageEvent({
                serverId: connection.url,
                provider: llmConfig.provider,
                model: llmConfig.model,
                messageCount: messages.length + 1,
                toolCallsCount,
                success: true,
                executionMode: 'client-side',
                duration: Date.now() - startTime,
              }),
            )
            .catch(() => {
              // Silently fail - telemetry should not break the application
            })
        }
      }
      catch (error) {
        console.error('Client-side agent error:', error)

        // Extract detailed error message
        let errorDetail = 'Unknown error occurred'
        if (error instanceof Error) {
          errorDetail = error.message
          // Check if error has HTTP status info
          const errorAny = error as any
          if (errorAny.status) {
            errorDetail = `HTTP ${errorAny.status}: ${errorDetail}`
          }
          if (errorAny.code === 401 || errorDetail.includes('401') || errorDetail.includes('Unauthorized')) {
            errorDetail = `Authentication failed (401). Check your Authorization header in the connection settings.`
          }
        }

        // Track failed chat message
        if (llmConfig) {
          const telemetry = Telemetry.getInstance()
          telemetry
            .capture(
              new MCPChatMessageEvent({
                serverId: connection.url,
                provider: llmConfig.provider,
                model: llmConfig.model,
                messageCount: messages.length + 1,
                toolCallsCount,
                success: false,
                executionMode: 'client-side',
                duration: Date.now() - startTime,
                error: errorDetail,
              }),
            )
            .catch(() => {
              // Silently fail - telemetry should not break the application
            })
        }

        const errorMessage: Message = {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: `Error: ${errorDetail}`,
          timestamp: Date.now(),
        }
        setMessages(prev => [...prev, errorMessage])
      }
      finally {
        setIsLoading(false)
        abortControllerRef.current = null
      }
    },
    [connection, llmConfig, isConnected, messages, readResource],
  )

  const clearMessages = useCallback(() => {
    setMessages([])
    if (agentRef.current) {
      agentRef.current.clearConversationHistory()
    }
  }, [])

  return {
    messages,
    isLoading,
    sendMessage,
    clearMessages,
  }
}
