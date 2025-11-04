import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { Textarea } from "@/client/components/ui/textarea";

interface ToolInputFormProps {
  selectedTool: Tool;
  toolArgs: Record<string, unknown>;
  onArgChange: (key: string, value: string) => void;
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
        const typedProp = prop as {
          type?: string;
          description?: string;
          required?: boolean;
        };
        typedProp.required = requiredFields.includes(key);

        // Get the current value and convert to string for display
        const currentValue = toolArgs[key];
        let stringValue = "";
        if (currentValue !== undefined && currentValue !== null) {
          if (typeof currentValue === "string") {
            stringValue = currentValue;
          } else {
            stringValue = JSON.stringify(currentValue, null, 2);
          }
        }

        // Use textarea for objects/arrays or complex types
        if (
          typedProp.type === "object" ||
          typedProp.type === "array" ||
          (typeof currentValue === "object" && currentValue !== null)
        ) {
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
