import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { Play, Save } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import { Spinner } from "@/client/components/ui/spinner";
import { ToolInputForm } from "./ToolInputForm";

interface ToolExecutionPanelProps {
  selectedTool: Tool | null;
  toolArgs: Record<string, unknown>;
  isExecuting: boolean;
  isConnected: boolean;
  onArgChange: (key: string, value: string) => void;
  onExecute: () => void;
  onSave: () => void;
}

export function ToolExecutionPanel({
  selectedTool,
  toolArgs,
  isExecuting,
  isConnected,
  onArgChange,
  onExecute,
  onSave,
}: ToolExecutionPanelProps) {
  if (!selectedTool) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center">
        <p className="text-gray-500 dark:text-gray-400 mb-2">
          Select a tool to get started
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Choose a tool from the list to view its details and execute it
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 p-3 sm:p-6 pt-3 pb-4 pr-3">
        <div>
          <div className="flex flex-row items-center justify-between mb-0 gap-2">
            <h3 className="text-base sm:text-lg font-semibold">
              {selectedTool.name}
            </h3>
            <div className="flex gap-2 flex-shrink-0">
              <Button
                onClick={onExecute}
                disabled={isExecuting || !isConnected}
                size="sm"
                className="lg:size-default"
              >
                {isExecuting ? (
                  <>
                    <Spinner className="mr-2" />
                    <span className="hidden sm:inline">Executing...</span>
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">Execute</span>
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={onSave}
                disabled={isExecuting}
                size="sm"
                className="lg:size-default gap-2"
              >
                <Save className="h-4 w-4" />
                <span className="hidden sm:inline">Save</span>
              </Button>
            </div>
          </div>
          {selectedTool.description && (
            <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed mt-2">
              {selectedTool.description}
            </p>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 sm:px-6 pb-4 pr-3">
        <ToolInputForm
          selectedTool={selectedTool}
          toolArgs={toolArgs}
          onArgChange={onArgChange}
        />
      </div>
    </div>
  );
}
