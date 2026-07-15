import { describe, expect, it } from "vitest";
import type { JsonSchemaType } from "@modelcontextprotocol/client";
import { DialectJsonSchemaValidator } from "../../../src/utils/json-schema-validator.js";

describe("DialectJsonSchemaValidator", () => {
  const validator = new DialectJsonSchemaValidator();

  it("accepts draft-07 schemas and validates conforming data", () => {
    const schema: JsonSchemaType = {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      $schema: "http://json-schema.org/draft-07/schema#",
    };

    const validate = validator.getValidator<{ name: string }>(schema);

    const valid = validate({ name: "alice" });
    expect(valid.valid).toBe(true);
    if (valid.valid) {
      expect(valid.data).toEqual({ name: "alice" });
      expect(valid.errorMessage).toBeUndefined();
    }

    const invalid = validate({});
    expect(invalid.valid).toBe(false);
    if (!invalid.valid) {
      expect(invalid.data).toBeUndefined();
      expect(invalid.errorMessage).toBeTruthy();
    }
  });

  it("accepts explicit 2020-12 schemas", () => {
    const schema: JsonSchemaType = {
      type: "object",
      properties: { count: { type: "number" } },
      required: ["count"],
      $schema: "https://json-schema.org/draft/2020-12/schema",
    };

    const validate = validator.getValidator<{ count: number }>(schema);
    expect(validate({ count: 1 }).valid).toBe(true);
    expect(validate({ count: "nope" }).valid).toBe(false);
  });

  it("defaults schemas without $schema to 2020-12", () => {
    const schema: JsonSchemaType = {
      type: "object",
      properties: { ok: { type: "boolean" } },
      required: ["ok"],
    };

    const validate = validator.getValidator<{ ok: boolean }>(schema);
    expect(validate({ ok: true }).valid).toBe(true);
    expect(validate({ ok: "yes" }).valid).toBe(false);
  });

  it("accepts draft-04 schemas", () => {
    const schema: JsonSchemaType = {
      type: "object",
      properties: { id: { type: "integer" } },
      required: ["id"],
      $schema: "http://json-schema.org/draft-04/schema#",
    };

    const validate = validator.getValidator<{ id: number }>(schema);
    expect(validate({ id: 1 }).valid).toBe(true);
    expect(validate({ id: "1" }).valid).toBe(false);
  });

  it("accepts 2019-09 schemas", () => {
    const schema: JsonSchemaType = {
      type: "object",
      properties: { tag: { type: "string" } },
      required: ["tag"],
      $schema: "https://json-schema.org/draft/2019-09/schema#",
    };

    const validate = validator.getValidator<{ tag: string }>(schema);
    expect(validate({ tag: "v1" }).valid).toBe(true);
    expect(validate({ tag: 1 }).valid).toBe(false);
  });

  it("throws for unknown $schema dialects", () => {
    const schema: JsonSchemaType = {
      type: "object",
      properties: { x: { type: "string" } },
      $schema: "https://example.com/my-schema",
    };

    expect(() => validator.getValidator(schema)).toThrow(/unsupported dialect/i);
  });

  it("validates v1-era server outputSchema shapes", () => {
    const schema: JsonSchemaType = {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      $schema: "http://json-schema.org/draft-07/schema#",
      additionalProperties: false,
    };

    const validate = validator.getValidator<{ text: string }>(schema);
    expect(validate({ text: "hi" }).valid).toBe(true);
    expect(validate({}).valid).toBe(false);
  });
});
