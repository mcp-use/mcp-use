/**
 * Type-level tests for InferToolInput and InferToolOutput
 * These tests verify that type inference works correctly at compile time
 */

import { describe, it, expectTypeOf } from "vitest";
import { z } from "zod";
import type {
  InferToolInput,
  InferToolOutput,
} from "../../../server/types/tool.js";

describe("Type Inference", () => {
  it("should infer input types from tool schema", () => {
    // Define a tool with schema
    const _toolDef = {
      name: "test-tool",
      schema: z.object({
        city: z.string(),
        temperature: z.number(),
        optional: z.string().optional(),
      }),
    };

    type Input = InferToolInput<typeof _toolDef>;

    // Verify the inferred type matches expected structure
    expectTypeOf<Input>().toEqualTypeOf<{
      city: string;
      temperature: number;
      optional?: string;
    }>();
  });

  it("should infer output types from tool outputSchema", () => {
    // Define a tool with outputSchema
    const _toolDef = {
      name: "test-tool",
      outputSchema: z.object({
        result: z.string(),
        count: z.number(),
        items: z.array(z.string()),
      }),
    };

    type Output = InferToolOutput<typeof _toolDef>;

    // Verify the inferred type matches expected structure
    expectTypeOf<Output>().toEqualTypeOf<{
      result: string;
      count: number;
      items: string[];
    }>();
  });

  it("should handle tools without schema", () => {
    const _toolDef = {
      name: "test-tool",
    };

    type Input = InferToolInput<typeof _toolDef>;
    type Output = InferToolOutput<typeof _toolDef>;

    // Should default to Record<string, any> for input
    expectTypeOf<Input>().toEqualTypeOf<Record<string, any>>();

    // Should default to Record<string, unknown> for output
    expectTypeOf<Output>().toEqualTypeOf<Record<string, unknown>>();
  });

  it("should handle complex nested schemas", () => {
    const _toolDef = {
      name: "complex-tool",
      schema: z.object({
        user: z.object({
          name: z.string(),
          age: z.number(),
        }),
        preferences: z.array(z.string()),
        metadata: z.record(z.string(), z.unknown()),
      }),
      outputSchema: z.object({
        success: z.boolean(),
        data: z.object({
          id: z.string(),
          timestamp: z.number(),
        }),
      }),
    };

    type Input = InferToolInput<typeof _toolDef>;
    type Output = InferToolOutput<typeof _toolDef>;

    expectTypeOf<Input>().toEqualTypeOf<{
      user: {
        name: string;
        age: number;
      };
      preferences: string[];
      metadata: Record<string, unknown>;
    }>();

    expectTypeOf<Output>().toEqualTypeOf<{
      success: boolean;
      data: {
        id: string;
        timestamp: number;
      };
    }>();
  });

  it("should handle optional and default fields correctly", () => {
    const _toolDef = {
      name: "test-tool",
      schema: z.object({
        required: z.string(),
        optional: z.string().optional(),
        withDefault: z.string().default("default"),
        nullableOptional: z.string().nullable().optional(),
      }),
    };

    type Input = InferToolInput<typeof _toolDef>;

    expectTypeOf<Input>().toEqualTypeOf<{
      required: string;
      optional?: string;
      withDefault?: string; // Zod makes it optional since it has a default
      nullableOptional?: string | null;
    }>();
  });
});
