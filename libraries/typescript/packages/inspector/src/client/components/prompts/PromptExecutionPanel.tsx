import type { Prompt } from "@modelcontextprotocol/sdk/types.js";
import { Play, Save } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/client/components/ui/button";
import { Spinner } from "@/client/components/ui/spinner";
import { PromptInputForm } from "./PromptInputForm";

interface PromptExecutionPanelProps {
  selectedPrompt: Prompt | null;
  promptArgs: Record<string, unknown>;
  isExecuting: boolean;
  isConnected: boolean;
  onArgChange: (key: string, value: any) => void;
  onExecute: () => void;
  onSave: () => void;
}

export function PromptExecutionPanel({
  selectedPrompt,
  promptArgs,
  isExecuting,
  isConnected,
  onArgChange,
  onExecute,
  onSave,
}: PromptExecutionPanelProps) {
  // Handle Cmd/Ctrl + Enter keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      // Check if Cmd/Ctrl + Enter is pressed
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        // Only execute if a prompt is selected and not already executing
        if (selectedPrompt && !isExecuting && isConnected) {
          event.preventDefault();
          onExecute();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedPrompt, isExecuting, isConnected, onExecute]);

  if (!selectedPrompt) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center">
        <p className="text-gray-500 dark:text-gray-400 mb-2">
          Select a prompt to get started
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Choose a prompt from the list to view its details and execute it
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
              {selectedPrompt.name}
            </h3>
            <div className="flex gap-2 flex-shrink-0">
              <Button
                onClick={onExecute}
                disabled={isExecuting || !isConnected}
                size="sm"
                className="lg:size-default pr-1! gap-0"
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
                    <span className="hidden sm:inline text-[12px] border text-zinc-300 p-1 rounded-full border-zinc-300 dark:text-zinc-600 dark:border-zinc-500 ml-2">
                      ⌘↵
                    </span>
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
          {selectedPrompt.description && (
            <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed mt-2">
              {selectedPrompt.description}
            </p>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 sm:px-6 pb-4 pr-3">
        <PromptInputForm
          selectedPrompt={selectedPrompt}
          promptArgs={promptArgs}
          onArgChange={onArgChange}
        />
      </div>
    </div>
  );
}
