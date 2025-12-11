/**
 * Schema helper utilities for tool registration
 *
 * This module provides utilities for converting between different schema formats
 * used in tool registration.
 */

import { z } from "zod";

/**
 * Convert a Zod object schema to the internal Record<string, z.ZodSchema> format
 *
 * @param zodSchema - Zod object schema to convert
 * @returns Object mapping parameter names to Zod validation schemas
 *
 * @example
 * ```typescript
 * const schema = z.object({
 *   name: z.string(),
 *   age: z.number().optional()
 * });
 * const params = convertZodSchemaToParams(schema);
 * // Returns: { name: z.string(), age: z.number().optional() }
 * ```
 */
export function convertZodSchemaToParams(
  zodSchema: z.ZodObject<any>
): Record<string, z.ZodSchema> {
  // Validate that it's a ZodObject
  if (!(zodSchema instanceof z.ZodObject)) {
    throw new Error("schema must be a Zod object schema (z.object({...}))");
  }

  // Extract the shape from the Zod object schema
  const shape = zodSchema.shape;
  const params: Record<string, z.ZodSchema> = {};

  // Convert each property in the shape
  for (const [key, value] of Object.entries(shape)) {
    params[key] = value as z.ZodSchema;
  }

  return params;
}

/**
 * Input definition for tool parameters
 */
export interface InputDefinition {
  name: string;
  type: string;
  required?: boolean;
  description?: string;
}

/**
 * Create input schema for tools
 *
 * Converts tool input definitions into Zod validation schemas for runtime validation.
 * Supports common data types (string, number, boolean, object, array) and optional
 * parameters. Used internally when registering tools with the MCP server.
 *
 * @param inputs - Array of input parameter definitions with name, type, and optional flag
 * @returns Object mapping parameter names to Zod validation schemas
 *
 * @example
 * ```typescript
 * const schema = createParamsSchema([
 *   { name: 'query', type: 'string', required: true, description: 'Search query' },
 *   { name: 'limit', type: 'number', required: false }
 * ])
 * // Returns: { query: z.string().describe('Search query'), limit: z.number().optional() }
 * ```
 */
export function createParamsSchema(
  inputs: InputDefinition[]
): Record<string, z.ZodSchema> {
  const schema: Record<string, z.ZodSchema> = {};

  inputs.forEach((input) => {
    let zodType: z.ZodSchema;
    switch (input.type) {
      case "string":
        zodType = z.string();
        break;
      case "number":
        zodType = z.number();
        break;
      case "boolean":
        zodType = z.boolean();
        break;
      case "object":
        zodType = z.object({});
        break;
      case "array":
        zodType = z.array(z.any());
        break;
      default:
        zodType = z.any();
    }

    // Add description if provided
    if (input.description) {
      zodType = zodType.describe(input.description);
    }

    if (!input.required) {
      zodType = zodType.optional();
    }

    schema[input.name] = zodType;
  });

  return schema;
}
