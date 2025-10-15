/**
 * Type declarations for optional observability dependencies.
 * These modules may not be installed, so we provide minimal type definitions.
 */

declare module 'langfuse-langchain' {
  export class CallbackHandler {
    constructor(config?: any)
    verbose?: boolean
    handleLLMStart(...args: any[]): Promise<void>
    handleChainStart(...args: any[]): Promise<void>
    handleToolStart(...args: any[]): Promise<void>
    handleRetrieverStart(...args: any[]): Promise<void>
    handleAgentAction(...args: any[]): Promise<void>
    handleAgentEnd(...args: any[]): Promise<void>
  }
}

declare module 'langfuse' {
  export class Langfuse {
    constructor(config: {
      publicKey?: string
      secretKey?: string
      baseUrl?: string
    })
  }
}
