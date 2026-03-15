/**
 * Utility to convert Zod schemas to TypeScript type strings
 * Used for auto-generating tool registry types
 */

import type { z } from "zod";

/**
 * Convert a Zod schema to a TypeScript type string
 * @param schema - The Zod schema to convert
 * @returns TypeScript type string representation
 */
export function zodToTypeString(schema: z.ZodTypeAny): string {
  const schemaAny = schema as any;
  const def = schemaAny._def || schemaAny.def || {};

  // Handle both Zod v3 (_def.typeName) and Zod v4 (.type or .def.type)
  let typeName =
    def.typeName ||
    def.type ||
    schemaAny.type ||
    (schemaAny._type
      ? `Zod${schemaAny._type.charAt(0).toUpperCase()}${schemaAny._type.slice(1)}`
      : undefined);

  // Special handling: if we have a shape property (including getters), it's a ZodObject
  // Try to access shape to trigger getter
  let hasShape = false;
  try {
    hasShape = !!(def.shape || schemaAny.shape);
  } catch {
    // Shape getter might throw
  }

  if (!typeName && hasShape) {
    typeName = "ZodObject"; // Directly use ZodObject
  }

  // Normalize type name to handle both Zod v3 (ZodString) and v4 (string/object)
  const normalizedType = typeName?.startsWith?.("Zod")
    ? typeName
    : typeName
      ? `Zod${typeName.charAt(0).toUpperCase()}${typeName.slice(1)}`
      : undefined;

  if (!normalizedType) {
    console.warn(
      `[zod-to-ts] Could not determine type for schema. typeName=${typeName}, hasShape=${hasShape}`
    );
    return "unknown";
  }

  switch (normalizedType) {
    case "ZodString":
      return "string";
    case "ZodNumber":
      return "number";
    case "ZodBoolean":
      return "boolean";
    case "ZodNull":
      return "null";
    case "ZodUndefined":
      return "undefined";
    case "ZodAny":
      return "any";
    case "ZodUnknown":
      return "unknown";
    case "ZodVoid":
      return "void";
    case "ZodNever":
      return "never";
    case "ZodDate":
      return "Date";
    case "ZodBigInt":
      return "bigint";

    case "ZodLiteral": {
      const value = def.value;
      if (typeof value === "string") {
        return `"${value.replace(/"/g, '\\"')}"`;
      }
      if (typeof value === "number") {
        return String(value);
      }
      if (typeof value === "boolean") {
        return String(value);
      }
      return "unknown";
    }

    case "ZodEnum": {
      const values = def.values as string[];
      return values.map((v) => `"${v.replace(/"/g, '\\"')}"`).join(" | ");
    }

    case "ZodNativeEnum": {
      // For native enums, we just return string | number as we can't introspect the actual enum
      return "string | number";
    }

    case "ZodOptional": {
      const innerType = zodToTypeString(def.innerType);
      return `${innerType} | undefined`;
    }

    case "ZodNullable": {
      const innerType = zodToTypeString(def.innerType);
      return `${innerType} | null`;
    }

    case "ZodDefault": {
      // Default values mean the field is not optional in the output type
      return zodToTypeString(def.innerType);
    }

    case "ZodArray": {
      // Handle both Zod v3 (def.type) and Zod v4 (def.element)
      // In Zod v4, the actual element schema is in def.element, NOT def.type
      const itemSchema = def.element || def.type || def.items;

      if (itemSchema) {
        const itemType = zodToTypeString(itemSchema);
        return `Array<${itemType}>`;
      }
      return "Array<unknown>";
    }

    case "ZodObject": {
      // Handle both Zod v3 (shape()) and v4 (def.shape or _def.shape)
      const shape = typeof def.shape === "function" ? def.shape() : def.shape;
      const entries: string[] = [];

      for (const [key, value] of Object.entries(shape || {})) {
        const valueSchema = value as z.ZodTypeAny;
        const valueDef =
          (valueSchema as any)._def || (valueSchema as any).def || {};
        const valueType =
          valueDef.typeName || (valueSchema as any).type || valueDef.type;
        const normalizedValueType = valueType?.startsWith?.("Zod")
          ? valueType
          : `Zod${valueType?.charAt?.(0)?.toUpperCase?.()}${valueType?.slice?.(1)}`;
        const isOptional = normalizedValueType === "ZodOptional";

        const typeStr = zodToTypeString(valueSchema);
        const optionalMarker = isOptional ? "?" : "";
        entries.push(`${JSON.stringify(key)}${optionalMarker}: ${typeStr}`);
      }

      if (entries.length === 0) {
        return "Record<string, never>";
      }

      return `{ ${entries.join("; ")} }`;
    }

    case "ZodRecord": {
      const keyType = def.keyType ? zodToTypeString(def.keyType) : "string";
      const valueType = zodToTypeString(def.valueType);
      return `Record<${keyType}, ${valueType}>`;
    }

    case "ZodUnion": {
      const options = def.options as z.ZodTypeAny[];
      const typeStrings = options.map(zodToTypeString);
      return typeStrings.join(" | ");
    }

    case "ZodDiscriminatedUnion": {
      const options = Array.from(def.optionsMap.values()) as z.ZodTypeAny[];
      const typeStrings = options.map(zodToTypeString);
      return typeStrings.join(" | ");
    }

    case "ZodIntersection": {
      const left = zodToTypeString(def.left);
      const right = zodToTypeString(def.right);
      return `(${left}) & (${right})`;
    }

    case "ZodTuple": {
      const items = def.items as z.ZodTypeAny[];
      const typeStrings = items.map(zodToTypeString);
      return `[${typeStrings.join(", ")}]`;
    }

    case "ZodEffects": {
      // For refinements/transforms, use the inner type
      return zodToTypeString(def.schema);
    }

    case "ZodBranded": {
      // For branded types, use the underlying type
      return zodToTypeString(def.type);
    }

    case "ZodCatch": {
      // For .catch(), use the inner type
      return zodToTypeString(def.innerType);
    }

    case "ZodPipeline": {
      // For pipelines, use the output type
      return zodToTypeString(def.out);
    }

    case "ZodLazy": {
      // For lazy types, we can't introspect at type-gen time
      return "unknown";
    }

    case "ZodPromise": {
      const innerType = zodToTypeString(def.type);
      return `Promise<${innerType}>`;
    }

    case "ZodFunction": {
      // Functions are complex, just return the generic Function type
      return "Function";
    }

    case "ZodMap": {
      const keyType = zodToTypeString(def.keyType);
      const valueType = zodToTypeString(def.valueType);
      return `Map<${keyType}, ${valueType}>`;
    }

    case "ZodSet": {
      const itemType = zodToTypeString(def.valueType);
      return `Set<${itemType}>`;
    }

    default:
      // Unknown Zod type, fallback to unknown
      console.warn(`[zod-to-ts] Unknown Zod type: ${typeName}`);
      return "unknown";
  }
}
