import { useCallback, useRef } from "react";
import type { LLMConfig } from "../chat/types";
import type {
  CreateMessageRequest,
  CreateMessageResult,
} from "@modelcontextprotocol/sdk/types.js";

interface UseSamplingLLMProps {
  llmConfig: LLMConfig | null;
}

interface GenerateResponseParams {
  request: CreateMessageRequest;
}

export function useSamplingLLM({ llmConfig }: UseSamplingLLMProps) {
  const llmRef = useRef<{
    instance: any;
    provider: string;
    model: string;
    apiKey: string;
  } | null>(null);

  const generateResponse = useCallback(
    async ({
      request,
    }: GenerateResponseParams): Promise<CreateMessageResult> => {
      if (!llmConfig) {
        throw new Error("LLM config is not available");
      }

      // Extract generation parameters from request
      const params = request.params || {};
      const maxTokens = params.maxTokens;
      const temperature = params.temperature;
      const _modelPreferences = params.modelPreferences;

      // Convert MCP messages to LangChain format
      const messages = params.messages || [];

      // Debug logging
      console.log("[useSamplingLLM] Request structure:", {
        hasParams: !!params,
        messagesCount: messages.length,
        messages: messages,
        params: params,
      });

      if (messages.length === 0) {
        throw new Error("No messages found in sampling request");
      }

      const langchainMessages: any[] = [];

      // Import message classes once
      const { HumanMessage, AIMessage } = await import(
        "@langchain/core/messages"
      );

      for (const msg of messages) {
        if (!msg || !msg.role) {
          console.warn("Skipping invalid message:", msg);
          continue;
        }

        const content = Array.isArray(msg.content)
          ? msg.content[0]
          : msg.content;

        if (!content) {
          console.warn("Skipping message with no content:", msg);
          continue;
        }

        if (content.type === "text" && content.text) {
          if (msg.role === "user") {
            langchainMessages.push(new HumanMessage(content.text));
          } else if (msg.role === "assistant") {
            langchainMessages.push(new AIMessage(content.text));
          }
        } else {
          console.warn(
            "Skipping message with unsupported content type:",
            content
          );
        }
      }

      if (langchainMessages.length === 0) {
        throw new Error(
          "No valid messages could be converted. Please ensure messages have 'text' content type."
        );
      }

      // Create or reuse LLM instance
      if (
        !llmRef.current ||
        llmRef.current.provider !== llmConfig.provider ||
        llmRef.current.model !== llmConfig.model ||
        llmRef.current.apiKey !== llmConfig.apiKey
      ) {
        let llm: any;
        const llmOptions: any = {
          model: llmConfig.model,
          apiKey: llmConfig.apiKey,
        };

        // Merge generation parameters
        if (maxTokens !== undefined) {
          llmOptions.maxTokens = maxTokens;
        }
        if (temperature !== undefined) {
          llmOptions.temperature = temperature;
        } else if (llmConfig.temperature !== undefined) {
          llmOptions.temperature = llmConfig.temperature;
        }

        if (llmConfig.provider === "openai") {
          const { ChatOpenAI } = await import("@langchain/openai");
          llm = new ChatOpenAI(llmOptions);
        } else if (llmConfig.provider === "anthropic") {
          const { ChatAnthropic } = await import("@langchain/anthropic");
          llm = new ChatAnthropic(llmOptions);
        } else if (llmConfig.provider === "google") {
          const { ChatGoogleGenerativeAI } = await import(
            "@langchain/google-genai"
          );
          llm = new ChatGoogleGenerativeAI(llmOptions);
        } else {
          throw new Error(`Unsupported LLM provider: ${llmConfig.provider}`);
        }

        llmRef.current = {
          instance: llm,
          provider: llmConfig.provider,
          model: llmConfig.model,
          apiKey: llmConfig.apiKey,
        };
      }

      // Call LLM directly
      const response = await llmRef.current.instance.invoke(langchainMessages);

      // Convert response to CreateMessageResult format
      const responseText = response.content || response.text || "";

      const result: CreateMessageResult = {
        role: "assistant",
        content: {
          type: "text",
          text: responseText,
        },
        model: llmConfig.model,
        stopReason: "endTurn",
      };

      return result;
    },
    [llmConfig]
  );

  return {
    generateResponse,
    isAvailable: llmConfig !== null,
  };
}
