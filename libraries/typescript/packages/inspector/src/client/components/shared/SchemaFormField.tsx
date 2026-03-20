import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { Textarea } from "@/client/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";

interface SchemaFormFieldProps {
  name: string;
  schema: any; // JSON Schema property definition
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  rootSchema?: any; // Root schema for resolving $refs
}

// Helper function to resolve $ref references in JSON schema
function resolveRef(schema: any, rootSchema: any): any {
  if (!schema?.$ref) return schema;

  const ref = schema.$ref;
  if (ref.startsWith("#/")) {
    const path = ref.substring(2).split("/"); // ["$defs", "Priority"]
    let current = rootSchema;

    for (const segment of path) {
      if (current && typeof current === "object" && segment in current) {
        current = current[segment];
      } else {
        console.warn(`Could not resolve $ref: ${ref}`);
        return schema; // Can't resolve, return original
      }
    }
    return current;
  }
  return schema;
}

// Helper function to normalize anyOf union types (FastMCP pattern)
function normalizeUnionType(schema: any, rootSchema: any): any {
  // Handle anyOf patterns (FastMCP uses this for optional fields)
  if (schema.anyOf && Array.isArray(schema.anyOf)) {
    // Find the non-null option
    const nonNullOption = schema.anyOf.find((opt: any) => {
      if (opt.type === "null") return false;
      return true; // This could be { type: "string" } or { $ref: "..." }
    });

    if (nonNullOption) {
      // If the non-null option is a $ref, resolve it first
      const resolved = resolveRef(nonNullOption, rootSchema);
      return { ...resolved, nullable: true };
    }
  }

  return schema;
}

// Helper function to extract enum values from schema
function extractEnum(schema: any): string[] | null {
  if (Array.isArray(schema.enum)) {
    return schema.enum as string[];
  }
  return null;
}

export function SchemaFormField({
  name,
  schema,
  value,
  onChange,
  required = false,
  disabled = false,
  rootSchema,
}: SchemaFormFieldProps) {
  // Use the schema itself as root if not provided
  const effectiveRootSchema = rootSchema || schema;

  // Step 1: Normalize anyOf unions (handles FastMCP optional fields with $ref)
  let resolvedProp = normalizeUnionType(schema, effectiveRootSchema);

  // Step 2: Resolve any remaining $refs at top level
  resolvedProp = resolveRef(resolvedProp, effectiveRootSchema);

  // Step 3: Extract enum values
  const enumValues = extractEnum(resolvedProp);
  const isEnum = resolvedProp.type === "string" && enumValues !== null;

  // Type checking
  const typedProp = resolvedProp as {
    type?: string;
    enum?: string[];
    enumNames?: string[];
    description?: string;
    default?: any;
    nullable?: boolean;
  };

  // Use textarea for objects/arrays or complex types
  const isObjectOrArray =
    typedProp.type === "object" || typedProp.type === "array";

  if (isObjectOrArray) {
    return (
      <div className="space-y-2">
        <Label htmlFor={name} className="text-sm font-medium">
          {name}
          {required && <span className="text-red-500 ml-1">*</span>}
        </Label>
        <Textarea
          id={name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            typedProp?.description || typedProp?.default
              ? JSON.stringify(typedProp.default, null, 2)
              : `Enter ${name}`
          }
          className="min-h-[100px]"
          disabled={disabled}
        />
        {typedProp?.description && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {typedProp.description}
          </p>
        )}
      </div>
    );
  }

  // Render Select dropdown for enum fields
  if (isEnum && enumValues) {
    return (
      <div className="space-y-2">
        <Label htmlFor={name} className="text-sm font-medium">
          {name}
          {required && <span className="text-red-500 ml-1">*</span>}
        </Label>
        <Select
          value={value || ""}
          onValueChange={onChange}
          disabled={disabled}
        >
          <SelectTrigger id={name} className="w-full">
            <SelectValue
              placeholder={typedProp.description || "Select an option"}
            />
          </SelectTrigger>
          <SelectContent>
            {enumValues.map((option, index) => (
              <SelectItem key={option} value={option}>
                {/* Use enumNames if available, otherwise use the enum value */}
                {typedProp.enumNames?.[index] || option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {typedProp.description && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {typedProp.description}
          </p>
        )}
      </div>
    );
  }

  // Default: render text input for string, number, boolean, etc.
  return (
    <div className="space-y-2">
      <Label htmlFor={name} className="text-sm font-medium">
        {name}
        {required && <span className="text-red-500 ml-1">*</span>}
      </Label>
      <Input
        id={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={
          typedProp?.description ||
          (typedProp?.default !== undefined
            ? String(typedProp.default)
            : `Enter ${name}`)
        }
        type={typedProp.type === "number" ? "number" : "text"}
        disabled={disabled}
      />
      {typedProp?.description && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {typedProp.description}
        </p>
      )}
    </div>
  );
}
