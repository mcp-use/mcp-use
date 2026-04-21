import { chat } from "@/llm/providers";
import type { ProviderMessage } from "@/llm/types";
import type { Resource } from "@modelcontextprotocol/sdk/types.js";
import { useCallback } from "react";
import type { LLMConfig } from "../components/chat/types";

interface UsePropsLLMProps {
  llmConfig: LLMConfig | null;
}

interface GeneratePropsParams {
  resource: Resource;
  resourceAnnotations?: Record<string, unknown>;
  propsSchema?: any;
}

export interface GeneratedProp {
  key: string;
  value: string;
}

/** Extract the outermost JSON object from LLM response (handles markdown code blocks and nested JSON). */
function extractOutermostJsonObject(
  text: string
): Record<string, unknown> | null {
  let raw = text.trim();
  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    raw = codeBlockMatch[1].trim();
  }
  const start = raw.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < raw.length; i++) {
    if (raw[i] === "{") depth++;
    else if (raw[i] === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(raw.slice(start, i + 1)) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function usePropsLLM({ llmConfig }: UsePropsLLMProps) {
  const generateProps = useCallback(
    async ({
      resource,
      resourceAnnotations,
      propsSchema,
    }: GeneratePropsParams): Promise<GeneratedProp[]> => {
      if (!llmConfig) {
        throw new Error("LLM config is not available");
      }

      const resourceType =
        resource.mimeType || resourceAnnotations?.mimeType || "unknown";
      const resourceDescription =
        resource.description || resourceAnnotations?.description || "N/A";

      if (propsSchema?.properties) {
        const propNames = Object.keys(propsSchema.properties);
        const propDescriptions = propNames
          .map((key) => {
            const prop = propsSchema.properties[key];
            const base = `  - ${key} (${prop.type || "string"})`;
            const desc = prop.description ? `: ${prop.description}` : "";
            let itemsHint = "";
            if (
              prop.type === "array" &&
              prop.items?.type === "object" &&
              prop.items?.properties
            ) {
              const itemKeys = Object.keys(prop.items.properties).join(", ");
              itemsHint = ` — array of objects with keys: {${itemKeys}}`;
            }
            return `${base}${itemsHint}${desc}`;
          })
          .join("\n");

        const systemPrompt = `You are helping a developer configure props for a UI widget. The widget has a defined schema with specific props. Generate appropriate values for ONLY the props listed in the schema. Return ONLY a JSON object with these exact keys. For array props, each item must match the specified structure.`;
        const userPrompt = `Widget: ${resource.name || resource.uri}
Description: ${resourceDescription}

Props Schema:
${propDescriptions}

Generate appropriate default/example values for these props. Return ONLY a JSON object with the exact prop names as keys.
Example: {"query": "example search term", "results": [{"fruit": "Apple", "color": "red"}]}`;

        const messages: ProviderMessage[] = [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ];
        const { text } = await chat({
          config: {
            provider: llmConfig.provider,
            model: llmConfig.model,
            apiKey: llmConfig.apiKey,
            temperature: llmConfig.temperature,
          },
          messages,
        });

        const parsed = extractOutermostJsonObject(text);
        if (parsed) {
          return Object.entries(parsed).map(([key, value]) => ({
            key,
            value:
              typeof value === "object" && value !== null
                ? JSON.stringify(value)
                : String(value),
          }));
        }
        throw new Error("Could not parse props from LLM response");
      }

      // Fallback: generic prop generation without schema.
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

      const messages: ProviderMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ];
      const { text } = await chat({
        config: {
          provider: llmConfig.provider,
          model: llmConfig.model,
          apiKey: llmConfig.apiKey,
          temperature: llmConfig.temperature,
        },
        messages,
      });

      try {
        const parsed = extractOutermostJsonObject(text);
        if (parsed) {
          return Object.entries(parsed).map(([key, value]) => ({
            key,
            value:
              typeof value === "object" && value !== null
                ? JSON.stringify(value)
                : String(value),
          }));
        }

        const lines = text.split("\n");
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
        if (props.length > 0) return props;
        throw new Error("Could not parse props from LLM response");
      } catch (parseError) {
        console.error(
          "[usePropsLLM] Failed to parse LLM response:",
          parseError
        );
        throw new Error(
          `Failed to parse props from LLM response: ${text.slice(0, 100)}...`
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
