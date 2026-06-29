/**
 * Type declarations for optional observability dependencies.
 * These modules may not be installed, so we provide minimal type definitions.
 */

import type { BaseCallbackHandler } from "@langchain/core/callbacks/base";

declare module "langfuse-langchain" {
  export class CallbackHandler extends BaseCallbackHandler {
    constructor(config?: unknown);
    name: string;
    verbose?: boolean;
    handleLLMStart(...args: unknown[]): Promise<void>;
    handleChainStart(...args: unknown[]): Promise<void>;
    handleToolStart(...args: unknown[]): Promise<void>;
    handleRetrieverStart(...args: unknown[]): Promise<void>;
    handleAgentAction(...args: unknown[]): Promise<void>;
    handleAgentEnd(...args: unknown[]): Promise<void>;
    flushAsync?(): Promise<void>;
    shutdownAsync?(): Promise<void>;
  }
}

declare module "langfuse" {
  export class Langfuse {
    constructor(config: {
      publicKey?: string;
      secretKey?: string;
      baseUrl?: string;
    });
    trace(config: {
      id?: string;
      name: string;
      sessionId?: string;
      userId?: string;
      metadata?: Record<string, unknown>;
      tags?: string[];
    }): LangfuseTrace;
    flushAsync(): Promise<void>;
    shutdownAsync(): Promise<void>;
  }

  export interface LangfuseTrace {
    id: string;
    span(config: {
      name: string;
      input?: unknown;
      metadata?: Record<string, unknown>;
    }): LangfuseSpan;
  }

  export interface LangfuseSpan {
    end(config?: {
      output?: unknown;
      metadata?: Record<string, unknown>;
    }): void;
  }
}
