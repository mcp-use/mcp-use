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
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

interface ToolInputFormProps {
  selectedTool: Tool;
  toolArgs: Record<string, unknown>;
  onArgChange: (key: string, value: string) => void;
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

export function ToolInputForm({
  selectedTool,
  toolArgs,
  onArgChange,
}: ToolInputFormProps) {
  const properties = selectedTool?.inputSchema?.properties || {};
  const requiredFields = (selectedTool?.inputSchema as any)?.required || [];
  const hasInputs = Object.keys(properties).length > 0;

  if (!hasInputs) {
    return (
      <div className="flex items-center justify-center h-32 text-gray-500 dark:text-gray-400 text-sm">
        No parameters required
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {Object.entries(properties).map(([key, prop]) => {
        const inputSchema = selectedTool?.inputSchema || {};

        // Step 1: Normalize anyOf unions (handles FastMCP optional fields with $ref)
        let resolvedProp = normalizeUnionType(prop, inputSchema);

        // Step 2: Resolve any remaining $refs at top level
        resolvedProp = resolveRef(resolvedProp, inputSchema);

        // Step 3: Extract enum values
        const enumValues = extractEnum(resolvedProp);
        const isEnum = resolvedProp.type === "string" && enumValues !== null;

        // Type checking
        const typedProp = resolvedProp as {
          type?: string;
          enum?: string[];
          enumNames?: string[];
          description?: string;
          required?: boolean;
          nullable?: boolean;
        };
        typedProp.required = requiredFields.includes(key);

        // Get the current value and convert to string for display
        const currentValue = toolArgs[key];
        let stringValue = "";
        if (currentValue !== undefined && currentValue !== null) {
          // If it's already a string, use it directly (preserves user formatting)
          if (typeof currentValue === "string") {
            stringValue = currentValue;
          } else if (
            typeof currentValue === "object" &&
            currentValue !== null
          ) {
            // Stringify objects/arrays for display (only happens on initial load)
            stringValue = JSON.stringify(currentValue, null, 2);
          } else {
            stringValue = String(currentValue);
          }
        }

        // Use textarea for objects/arrays or complex types
        const isObjectOrArray =
          typedProp.type === "object" || typedProp.type === "array";
        if (isObjectOrArray) {
          return (
            <div key={key} className="space-y-2">
              <Label htmlFor={key} className="text-sm font-medium">
                {key}
                {typedProp?.required && (
                  <span className="text-red-500 ml-1">*</span>
                )}
              </Label>
              <Textarea
                id={key}
                value={stringValue}
                onChange={(e) => onArgChange(key, e.target.value)}
                placeholder={typedProp?.description || `Enter ${key}`}
                className="min-h-[100px]"
              />
              {typedProp?.description && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {typedProp.description}
                </p>
              )}
            </div>
          );
        }

        // Render Select dropdown for enum fields (including FastMCP enums)
        if (isEnum && enumValues) {
          return (
            <div key={key} className="space-y-2">
              <Label htmlFor={key} className="text-sm font-medium">
                {key}
                {typedProp.required && (
                  <span className="text-red-500 ml-1">*</span>
                )}
              </Label>
              <Select
                value={String(toolArgs[key] || "")}
                onValueChange={(value) => onArgChange(key, value)}
              >
                <SelectTrigger id={key} className="w-full">
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

        return (
          <div key={key} className="space-y-2">
            <Label htmlFor={key} className="text-sm font-medium">
              {key}
              {typedProp?.required && (
                <span className="text-red-500 ml-1">*</span>
              )}
            </Label>
            <Input
              id={key}
              value={stringValue}
              onChange={(e) => onArgChange(key, e.target.value)}
              placeholder={typedProp?.description || `Enter ${key}`}
            />
            {typedProp?.description && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {typedProp.description}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
