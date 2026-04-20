import { chat } from "@/llm/providers";
import type { ProviderMessage } from "@/llm/types";
import type {
  CreateMessageRequest,
  CreateMessageResult,
} from "@modelcontextprotocol/sdk/types.js";
import { useCallback } from "react";
import type { LLMConfig } from "../chat/types";

interface UseSamplingLLMProps {
  llmConfig: LLMConfig | null;
}

interface GenerateResponseParams {
  request: CreateMessageRequest;
}

export function useSamplingLLM({ llmConfig }: UseSamplingLLMProps) {
  const generateResponse = useCallback(
    async ({
      request,
    }: GenerateResponseParams): Promise<CreateMessageResult> => {
      if (!llmConfig) {
        throw new Error("LLM config is not available");
      }

      const params = request.params || {};
      const maxTokens = params.maxTokens;
      const temperature = params.temperature;
      const messages = params.messages || [];

      if (messages.length === 0) {
        throw new Error("No messages found in sampling request");
      }

      const providerMessages: ProviderMessage[] = [];
      for (const msg of messages) {
        if (!msg || !msg.role) continue;
        const content = Array.isArray(msg.content)
          ? msg.content[0]
          : msg.content;
        if (!content) continue;
        if (content.type === "text" && content.text) {
          if (msg.role === "user" || msg.role === "assistant") {
            providerMessages.push({ role: msg.role, content: content.text });
          }
        }
      }

      if (providerMessages.length === 0) {
        throw new Error(
          "No valid messages could be converted. Please ensure messages have 'text' content type."
        );
      }

      const { text } = await chat({
        config: {
          provider: llmConfig.provider,
          model: llmConfig.model,
          apiKey: llmConfig.apiKey,
          temperature: temperature ?? llmConfig.temperature,
          maxTokens,
        },
        messages: providerMessages,
      });

      return {
        role: "assistant",
        content: {
          type: "text",
          text,
        },
        model: llmConfig.model,
        stopReason: "endTurn",
      };
    },
    [llmConfig]
  );

  return {
    generateResponse,
    isAvailable: llmConfig !== null,
  };
}
