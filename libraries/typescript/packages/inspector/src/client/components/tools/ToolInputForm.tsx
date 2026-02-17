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
import { extractEnumValues, resolveToolPropertySchema } from "./schema-utils";

interface ToolInputFormProps {
  selectedTool: Tool;
  toolArgs: Record<string, unknown>;
  onArgChange: (key: string, value: string) => void;
  onBulkPaste?: (pastedText: string, fieldKey: string) => Promise<boolean>;
  autoFilledFields?: Set<string>;
}

export function ToolInputForm({
  selectedTool,
  toolArgs,
  onArgChange,
  onBulkPaste,
  autoFilledFields,
}: ToolInputFormProps) {
  const properties = selectedTool?.inputSchema?.properties || {};
  const requiredFields = (selectedTool?.inputSchema as any)?.required || [];
  const hasInputs = Object.keys(properties).length > 0;

  // Handle paste events to detect and auto-fill from pasted objects
  const handlePaste = async (
    e: React.ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    fieldKey: string
  ) => {
    if (!onBulkPaste) return;

    const pastedText = e.clipboardData.getData("text");

    // Try to handle as bulk paste
    const handled = await onBulkPaste(pastedText, fieldKey);

    // If bulk paste was handled, prevent default paste behavior
    if (handled) {
      e.preventDefault();
    }
    // Otherwise, let the default paste behavior proceed
  };

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

        const resolvedProp = resolveToolPropertySchema(
          prop,
          inputSchema as any
        );
        const enumValues = extractEnumValues(resolvedProp);
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
                data-testid={`tool-param-${key}`}
                value={stringValue}
                onChange={(e) => onArgChange(key, e.target.value)}
                onPaste={(e) => handlePaste(e, key)}
                placeholder={typedProp?.description || `Enter ${key}`}
                className={`min-h-[100px] ${autoFilledFields?.has(key) ? "animate-pulse ring-2 ring-green-500 dark:ring-green-400" : ""}`}
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
                <SelectTrigger
                  id={key}
                  className="w-full"
                  data-testid={`tool-param-${key}`}
                >
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
              data-testid={`tool-param-${key}`}
              value={stringValue}
              onChange={(e) => onArgChange(key, e.target.value)}
              onPaste={(e) => handlePaste(e, key)}
              placeholder={typedProp?.description || `Enter ${key}`}
              className={
                autoFilledFields?.has(key)
                  ? "animate-pulse ring-2 ring-green-500 dark:ring-green-400"
                  : ""
              }
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
