import { useCallback, useRef } from "react";
import type { LLMConfig } from "../components/chat/types";
import type { Resource } from "@modelcontextprotocol/sdk/types.js";

interface UsePropsLLMProps {
  llmConfig: LLMConfig | null;
}

interface GeneratePropsParams {
  resource: Resource;
  resourceAnnotations?: Record<string, unknown>;
  propsSchema?: any; // JSON Schema for the props (if available)
}

export interface GeneratedProp {
  key: string;
  value: string;
}

export function usePropsLLM({ llmConfig }: UsePropsLLMProps) {
  const llmRef = useRef<{
    instance: any;
    provider: string;
    model: string;
    apiKey: string;
  } | null>(null);

  const generateProps = useCallback(
    async ({
      resource,
      resourceAnnotations,
      propsSchema,
    }: GeneratePropsParams): Promise<GeneratedProp[]> => {
      if (!llmConfig) {
        throw new Error("LLM config is not available");
      }

      // Build context about the resource
      const resourceType =
        resource.mimeType || resourceAnnotations?.mimeType || "unknown";
      const resourceDescription =
        resource.description || resourceAnnotations?.description || "N/A";

      // If we have a schema, use it to guide generation
      if (propsSchema?.properties) {
        const propNames = Object.keys(propsSchema.properties);
        const propDescriptions = propNames
          .map((key) => {
            const prop = propsSchema.properties[key];
            return `  - ${key} (${prop.type || "string"})${prop.description ? `: ${prop.description}` : ""}`;
          })
          .join("\n");

        const systemPrompt = `You are helping a developer configure props for a UI widget. The widget has a defined schema with specific props. Generate appropriate values for ONLY the props listed in the schema. Return ONLY a JSON object with these exact keys.`;

        const userPrompt = `Widget: ${resource.name || resource.uri}
Description: ${resourceDescription}

Props Schema:
${propDescriptions}

Generate appropriate default/example values for these props. Return ONLY a JSON object with the exact prop names as keys.
Example: {"query": "example search term"}`;

        const { SystemMessage, HumanMessage } =
          await import("@langchain/core/messages");

        const messages = [
          new SystemMessage(systemPrompt),
          new HumanMessage(userPrompt),
        ];

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
            temperature: llmConfig.temperature ?? 0.7,
          };

          if (llmConfig.provider === "openai") {
            const { ChatOpenAI } = await import("@langchain/openai");
            llm = new ChatOpenAI(llmOptions);
          } else if (llmConfig.provider === "anthropic") {
            const { ChatAnthropic } = await import("@langchain/anthropic");
            llm = new ChatAnthropic(llmOptions);
          } else if (llmConfig.provider === "google") {
            const { ChatGoogleGenerativeAI } =
              await import("@langchain/google-genai");
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

        const response = await llmRef.current.instance.invoke(messages);
        const responseText = response.content || response.text || "";

        // Parse JSON response
        const jsonMatch = responseText.match(/\{[^{}]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return Object.entries(parsed).map(([key, value]) => ({
            key,
            value: String(value),
          }));
        }

        throw new Error("Could not parse props from LLM response");
      }

      // Fallback: generic prop generation without schema
      const isOpenAIWidget = !!(
        resourceAnnotations &&
        Object.keys(resourceAnnotations).some((key) =>
          key.startsWith("openai/")
        )
      );
      const isMcpUI =
        typeof resourceType === "string" &&
        (resourceType.toLowerCase().includes("mcp-ui") ||
          resourceType.toLowerCase().includes("html") ||
          resourceType.toLowerCase().includes("remote-dom"));

      // Construct prompt with rich context
      const systemPrompt = `You are helping a developer configure props for a UI widget/resource. 
Analyze the provided information and suggest appropriate props in key-value format.
Return ONLY a JSON object with key-value pairs, where both keys and values are strings.
Example format: {"theme": "dark", "width": "400", "title": "My Widget"}`;

      const userPrompt = `Resource Information:
- URI: ${resource.uri}
- Name: ${resource.name || "N/A"}
- Type: ${resourceType}
- Description: ${resourceDescription}
- Is OpenAI Widget: ${isOpenAIWidget ? "Yes" : "No"}
- Is MCP UI Resource: ${isMcpUI ? "Yes" : "No"}

Based on this information, suggest 3-5 common customizable properties like theme, dimensions, colors, titles, or configuration options that would be useful for this type of resource. Keep it simple and practical.`;

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

        // Only add temperature if explicitly configured to avoid model-specific issues
        if (llmConfig.temperature !== undefined) {
          llmOptions.temperature = llmConfig.temperature;
        }

        if (llmConfig.provider === "openai") {
          const { ChatOpenAI } = await import("@langchain/openai");
          llm = new ChatOpenAI(llmOptions);
        } else if (llmConfig.provider === "anthropic") {
          const { ChatAnthropic } = await import("@langchain/anthropic");
          llm = new ChatAnthropic(llmOptions);
        } else if (llmConfig.provider === "google") {
          const { ChatGoogleGenerativeAI } =
            await import("@langchain/google-genai");
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

      // Import message classes
      const { SystemMessage, HumanMessage } =
        await import("@langchain/core/messages");

      const messages = [
        new SystemMessage(systemPrompt),
        new HumanMessage(userPrompt),
      ];

      // Call LLM
      const response = await llmRef.current.instance.invoke(messages);
      const responseText = response.content || response.text || "";

      // Parse the response to extract key-value pairs
      try {
        // Try to extract JSON from the response
        const jsonMatch = responseText.match(/\{[^{}]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          // Convert to GeneratedProp array
          return Object.entries(parsed).map(([key, value]) => ({
            key,
            value: String(value),
          }));
        }

        // Fallback: try to parse lines like "key: value" or "key = value"
        const lines = responseText.split("\n");
        const props: GeneratedProp[] = [];
        for (const line of lines) {
          const match = line.match(
            /^\s*["']?(\w+)["']?\s*[:=]\s*["']?(.+?)["']?\s*,?\s*$/
          );
          if (match) {
            props.push({
              key: match[1].trim(),
              value: match[2].trim().replace(/^["']|["']$/g, ""),
            });
          }
        }

        if (props.length > 0) {
          return props;
        }

        throw new Error("Could not parse props from LLM response");
      } catch (parseError) {
        console.error(
          "[usePropsLLM] Failed to parse LLM response:",
          parseError
        );
        throw new Error(
          `Failed to parse props from LLM response: ${responseText.slice(0, 100)}...`
        );
      }
    },
    [llmConfig]
  );

  return {
    generateProps,
    isAvailable: llmConfig !== null,
  };
}
