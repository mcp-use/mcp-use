import type { AIMessage, HumanMessage, ToolMessage, SystemMessage } from '@langchain/core/messages'

export type BaseMessage = AIMessage | HumanMessage | ToolMessage | SystemMessage
