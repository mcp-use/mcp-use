import { z } from "zod";
import { isReferenceObject, resolveRef } from "./refs.js";
import type {
  CollectedOpenAPIOperation,
  OpenAPIDocument,
  OpenAPIReferenceObject,
  OpenAPISchemaObject,
} from "./types.js";

export function createToolInputSchema(
  spec: OpenAPIDocument,
  operation: CollectedOpenAPIOperation
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const parameter of operation.parameters) {
    if (parameter.in === "cookie") {
      continue;
    }

    const parameterSchema = parameter.schema
      ? schemaToZod(spec, parameter.schema)
      : z.any();
    const described = parameter.description
      ? parameterSchema.describe(parameter.description)
      : parameterSchema.describe(`${parameter.in} parameter`);

    shape[parameter.name] =
      parameter.required || parameter.in === "path"
        ? described
        : described.optional();
  }

  const jsonBodySchema = getJsonRequestBodySchema(operation.requestBody);
  if (jsonBodySchema) {
    const bodySchema = schemaToZod(spec, jsonBodySchema);
    shape.body = operation.requestBody?.required
      ? bodySchema
      : bodySchema.optional();
  }

  return z.object(shape);
}

export function schemaToZod(
  spec: OpenAPIDocument,
  schemaOrRef: OpenAPISchemaObject | OpenAPIReferenceObject
): z.ZodTypeAny {
  const schema = resolveRef<OpenAPISchemaObject>(spec, schemaOrRef);

  if (!schema || typeof schema !== "object" || isReferenceObject(schema)) {
    return z.any();
  }

  if (schema.enum && schema.enum.length > 0) {
    return withNullable(schema, enumToZod(schema.enum));
  }

  if (schema.oneOf?.length || schema.anyOf?.length) {
    const variants = schema.oneOf ?? schema.anyOf ?? [];
    const zodVariants = variants.map((variant) => schemaToZod(spec, variant));
    if (zodVariants.length === 1) {
      return withNullable(schema, zodVariants[0]);
    }
    if (zodVariants.length >= 2) {
      return withNullable(schema, z.union(zodVariants as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]));
    }
  }

  if (schema.allOf?.length) {
    const objectSchemas = schema.allOf
      .map((part) => schemaToZod(spec, part))
      .filter((part): part is z.ZodObject<any> => part instanceof z.ZodObject);

    if (objectSchemas.length > 0) {
      return withNullable(
        schema,
        objectSchemas.slice(1).reduce((merged, current) => merged.merge(current), objectSchemas[0])
      );
    }
  }

  const schemaType = Array.isArray(schema.type)
    ? schema.type.find((type) => type !== "null")
    : schema.type;

  switch (schemaType) {
    case "string":
      return withNullable(schema, z.string());
    case "integer":
    case "number":
      return withNullable(schema, z.number());
    case "boolean":
      return withNullable(schema, z.boolean());
    case "array":
      return withNullable(
        schema,
        z.array(schema.items ? schemaToZod(spec, schema.items) : z.any())
      );
    case "object":
      return withNullable(schema, objectSchemaToZod(spec, schema));
    default:
      if (schema.properties) {
        return withNullable(schema, objectSchemaToZod(spec, schema));
      }
      return withNullable(schema, z.any());
  }
}

function objectSchemaToZod(
  spec: OpenAPIDocument,
  schema: OpenAPISchemaObject
): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};
  const required = new Set(schema.required ?? []);

  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    const resolvedProperty = resolveRef<OpenAPISchemaObject>(spec, property);
    const description =
      !isReferenceObject(resolvedProperty) && resolvedProperty.description
        ? resolvedProperty.description
        : undefined;
    const propertySchema = schemaToZod(spec, property);
    const described = description ? propertySchema.describe(description) : propertySchema;

    shape[name] = required.has(name) ? described : described.optional();
  }

  return z.object(shape);
}

function enumToZod(values: Array<string | number | boolean | null>): z.ZodTypeAny {
  if (values.every((value): value is string => typeof value === "string")) {
    return z.enum(values as [string, ...string[]]);
  }

  if (values.length === 1) {
    return z.literal(values[0]);
  }

  return z.union(
    values.map((value) => z.literal(value)) as [
      z.ZodLiteral<any>,
      z.ZodLiteral<any>,
      ...z.ZodLiteral<any>[],
    ]
  );
}

function withNullable(schema: OpenAPISchemaObject, zodSchema: z.ZodTypeAny): z.ZodTypeAny {
  if (
    schema.nullable ||
    (Array.isArray(schema.type) && schema.type.includes("null")) ||
    schema.enum?.includes(null)
  ) {
    return zodSchema.nullable();
  }

  return zodSchema;
}

function getJsonRequestBodySchema(
  requestBody: CollectedOpenAPIOperation["requestBody"]
): OpenAPISchemaObject | OpenAPIReferenceObject | undefined {
  const content = requestBody?.content;
  if (!content) {
    return undefined;
  }

  return (
    content["application/json"]?.schema ??
    content["application/*+json"]?.schema ??
    Object.entries(content).find(([mediaType]) =>
      mediaType.includes("+json")
    )?.[1].schema
  );
}
