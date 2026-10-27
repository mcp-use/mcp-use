import type { ElicitRequestFormParams } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import { applyDefaults, validate } from "../../src/utils/elicitation.js";
import { DialectJsonSchemaValidator } from "../../src/utils/json-schema-validator.js";

const params: ElicitRequestFormParams = {
  mode: "form",
  message: "Choose a priority",
  requestedSchema: {
    type: "object",
    properties: {
      priority: { type: "integer", minimum: 0, maximum: 2, default: 1 },
    },
    required: ["priority"],
  },
};

describe("elicitation validation with schema defaults", () => {
  it("rejects missing required content even when the schema has a default", () => {
    const content = {};
    const schemaValidator = new DialectJsonSchemaValidator().getValidator(
      params.requestedSchema
    );
    expect(schemaValidator(content).valid).toBe(false);
    expect(validate(params, content)).toEqual({
      valid: false,
      errors: ["priority: Required"],
    });
    expect(content).toEqual({});
  });

  it("accepts defaults explicitly applied by the caller and preserves zero", () => {
    expect(applyDefaults(params)).toEqual({ priority: 1 });
    expect(validate(params, applyDefaults(params))).toEqual({ valid: true });
    expect(validate(params, { priority: 0 })).toEqual({ valid: true });
    expect(validate(params, { priority: 3 }).valid).toBe(false);
  });

  it("allows absent optional fields with defaults", () => {
    expect(
      validate(
        {
          ...params,
          requestedSchema: { ...params.requestedSchema, required: [] },
        },
        {}
      )
    ).toEqual({ valid: true });
  });

  it("reports each missing required field before applying defaults", () => {
    const confirmation: ElicitRequestFormParams = {
      ...params,
      requestedSchema: {
        ...params.requestedSchema,
        properties: {
          ...params.requestedSchema.properties,
          confirmed: { type: "boolean", default: false },
        },
        required: ["priority", "confirmed"],
      },
    };
    expect(validate(confirmation, {})).toEqual({
      valid: false,
      errors: ["priority: Required", "confirmed: Required"],
    });
    expect(validate(confirmation, applyDefaults(confirmation))).toEqual({
      valid: true,
    });
  });
});
