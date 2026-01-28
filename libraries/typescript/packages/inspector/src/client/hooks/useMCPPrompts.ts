import { useState, useCallback, useEffect, useMemo } from "react";
import type {
  Prompt,
  GetPromptResult,
} from "@modelcontextprotocol/sdk/types.js";
import { MCPPromptCallEvent, Telemetry } from "@/client/telemetry";

export interface PromptResult {
  promptName: string;
  args: Record<string, unknown>;
  result: GetPromptResult | { error?: string; isError?: boolean };
  error?: string;
  timestamp: number;
  duration?: number;
}

interface UseMCPPromptsProps {
  prompts: Prompt[];
  callPrompt: (
    name: string,
    args?: Record<string, unknown>
  ) => Promise<GetPromptResult>;
  serverId: string;
}

/**
 * Manages prompt selection, execution, and results for an MCP server.
 * Provides filtered prompts, execution state, and result management.
 */
export function useMCPPrompts({
  prompts,
  callPrompt,
  serverId,
}: UseMCPPromptsProps) {
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
  const [promptArgs, setPromptArgs] = useState<Record<string, unknown>>({});
  const [results, setResults] = useState<PromptResult[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Filter prompts based on search query
  const filteredPrompts = useMemo(() => {
    if (!searchQuery.trim()) return prompts;

    const query = searchQuery.toLowerCase();
    return prompts.filter(
      (prompt) =>
        prompt.name.toLowerCase().includes(query) ||
        prompt.description?.toLowerCase().includes(query)
    );
  }, [prompts, searchQuery]);

  const handlePromptSelect = useCallback((prompt: Prompt) => {
    setSelectedPrompt(prompt);
    // Initialize args with default values based on prompt input schema
    const initialArgs: Record<string, unknown> = {};
    if (prompt.arguments) {
      // Handle MCP SDK structure: arguments is an array of PromptArgument objects
      prompt.arguments.forEach((arg) => {
        initialArgs[arg.name] = "";
      });
    }
    setPromptArgs(initialArgs);
  }, []);

  const handleArgChange = useCallback((key: string, value: any) => {
    setPromptArgs((prev) => ({ ...prev, [key]: value }));
  }, []);

  const executePrompt = useCallback(async () => {
    if (!selectedPrompt || isExecuting) return;

    setIsExecuting(true);
    const startTime = Date.now();

    try {
      const result = await callPrompt(selectedPrompt.name, promptArgs);
      const duration = Date.now() - startTime;

      // Track successful prompt call
      const telemetry = Telemetry.getInstance();
      telemetry
        .capture(
          new MCPPromptCallEvent({
            promptName: selectedPrompt.name,
            serverId,
            success: true,
          })
        )
        .catch(() => {
          // Silently fail - telemetry should not break the application
        });

      setResults((prev) => [
        {
          promptName: selectedPrompt.name,
          args: promptArgs,
          result,
          timestamp: startTime,
          duration,
        },
        ...prev,
      ]);
    } catch (error) {
      // Track failed prompt call
      const telemetry = Telemetry.getInstance();
      telemetry
        .capture(
          new MCPPromptCallEvent({
            promptName: selectedPrompt.name,
            serverId,
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          })
        )
        .catch(() => {
          // Silently fail - telemetry should not break the application
        });

      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorResult: PromptResult = {
        promptName: selectedPrompt.name,
        args: promptArgs,
        result: { error: errorMessage, isError: true },
        error: errorMessage,
        timestamp: startTime,
        duration: Date.now() - startTime,
      };

      setResults((prev) => [errorResult, ...prev]);
    } finally {
      setIsExecuting(false);
    }
  }, [selectedPrompt, promptArgs, isExecuting, callPrompt, serverId]);

  const handleDeleteResult = useCallback((index: number) => {
    setResults((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // Sync selectedPrompt with updated prompts list (for HMR support)
  // When prompts change via HMR, update selectedPrompt to the new object reference
  useEffect(() => {
    if (selectedPrompt) {
      const updatedPrompt = prompts.find((p) => p.name === selectedPrompt.name);

      // If prompt no longer exists in the list, clear selection
      if (!updatedPrompt) {
        setSelectedPrompt(null);
        return;
      }

      if (updatedPrompt !== selectedPrompt) {
        // Prompt definition changed - update the reference
        const hasChanges =
          JSON.stringify(updatedPrompt.arguments) !==
            JSON.stringify(selectedPrompt.arguments) ||
          updatedPrompt.description !== selectedPrompt.description;
        if (hasChanges) {
          setSelectedPrompt(updatedPrompt);
        }
      }
    }
  }, [prompts, selectedPrompt]);

  return {
    filteredPrompts,
    selectedPrompt,
    setSelectedPrompt,
    results,
    handleDeleteResult,
    promptArgs,
    setPromptArgs,
    isExecuting,
    handlePromptSelect,
    handleArgChange,
    executePrompt,
    searchQuery,
    setSearchQuery,
  };
}
