/**
 * Anthropic tool definition type
 */
export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
}

/**
 * Helper to create tool definitions with proper typing
 */
export function createToolDefinition(def: {
  name: string;
  description: string;
  properties: Record<string, any>;
  required: string[];
}): AnthropicTool {
  return {
    name: def.name,
    description: def.description,
    input_schema: {
      type: "object",
      properties: def.properties,
      required: def.required,
    },
  };
}
