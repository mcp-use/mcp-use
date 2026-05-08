import { useCallback, useRef } from "react";
import type {
  CompleteRequestParams,
  CompleteResult,
} from "@modelcontextprotocol/sdk/types.js";

interface UseCompletionOptions {
  /**
   * The complete() function from UseMcpResult / McpServer.
   * When undefined (disconnected or server doesn't expose it), all
   * completion calls are short-circuited and return [].
   */
  complete:
    | ((params: CompleteRequestParams) => Promise<CompleteResult>)
    | undefined;
  /** Whether the MCP connection is currently in the "ready" state. */
  isConnected: boolean;
}

interface UseCompletionResult {
  /**
   * Fetch completion suggestions for a named argument of a specific prompt.
   *
   * @param promptName - The name of the prompt being filled in
   * @param argName    - The argument whose value is being completed
   * @param value      - The partial value typed so far
   * @returns Array of suggestion strings, or [] on error / unsupported
   */
  fetchPromptArgCompletion: (
    promptName: string,
    argName: string,
    value: string
  ) => Promise<string[]>;

  /**
   * Fetch completion suggestions for a named variable in a resource template URI.
   *
   * @param templateUri - The URI template string (e.g. "file:///{path}")
   * @param varName     - The variable name being completed (e.g. "path")
   * @param value       - The partial value typed so far
   * @returns Array of suggestion strings, or [] on error / unsupported
   */
  fetchResourceTemplateCompletion: (
    templateUri: string,
    varName: string,
    value: string
  ) => Promise<string[]>;
}

/**
 * Provides debounced completion fetching for prompt arguments and resource
 * template URI variables using the MCP `completion/complete` protocol method.
 *
 * Completion calls are silently swallowed on error so the UI degrades
 * gracefully when the connected server does not support completions.
 */
export function useCompletion({
  complete,
  isConnected,
}: UseCompletionOptions): UseCompletionResult {
  // Track in-flight debounce timers per call site so parallel inputs don't
  // interfere with each other. Keys are `${type}:${name}:${argName}`.
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );

  /**
   * Core implementation: issues a single completion request and returns the
   * values array. Returns [] on any error or when completion is unavailable.
   */
  const _fetch = useCallback(
    async (params: CompleteRequestParams): Promise<string[]> => {
      if (!complete || !isConnected) return [];
      try {
        const result = await complete(params);
        return result?.completion?.values ?? [];
      } catch {
        // Servers that don't implement completion return an error.
        // We degrade gracefully — plain input without suggestions.
        return [];
      }
    },
    [complete, isConnected]
  );

  /**
   * Returns a debounced wrapper that calls _fetch after `delayMs` ms.
   * If called again before the delay expires the previous call is cancelled.
   */
  const _debounced = useCallback(
    (
      key: string,
      params: CompleteRequestParams,
      delayMs = 300
    ): Promise<string[]> => {
      const existing = timersRef.current.get(key);
      if (existing) clearTimeout(existing);

      return new Promise<string[]>((resolve) => {
        const timer = setTimeout(() => {
          timersRef.current.delete(key);
          _fetch(params).then(resolve).catch(() => resolve([]));
        }, delayMs);
        timersRef.current.set(key, timer);
      });
    },
    [_fetch]
  );

  const fetchPromptArgCompletion = useCallback(
    (promptName: string, argName: string, value: string): Promise<string[]> => {
      const key = `prompt:${promptName}:${argName}`;
      const params: CompleteRequestParams = {
        ref: { type: "ref/prompt", name: promptName },
        argument: { name: argName, value },
      };
      return _debounced(key, params);
    },
    [_debounced]
  );

  const fetchResourceTemplateCompletion = useCallback(
    (
      templateUri: string,
      varName: string,
      value: string
    ): Promise<string[]> => {
      const key = `resource:${templateUri}:${varName}`;
      const params: CompleteRequestParams = {
        ref: { type: "ref/resource", uri: templateUri },
        argument: { name: varName, value },
      };
      return _debounced(key, params);
    },
    [_debounced]
  );

  return { fetchPromptArgCompletion, fetchResourceTemplateCompletion };
}
