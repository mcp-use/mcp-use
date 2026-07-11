import { useCallback } from "react";

import { useViewRuntime } from "../runtime/view-runtime-context.js";

/**
 * Returns a callback that sends a follow-up message to the conversation,
 * triggering a model turn.
 *
 * @remarks
 * The prompt is delivered to the host as a user-authored chat message, as if
 * the user had typed it. The returned promise resolves when the host accepts
 * the message — not when the model responds; any response arrives through the
 * normal conversation flow (and, if the model calls this view's tool again,
 * through {@link useToolContext}). Hosts may require user confirmation or
 * decline the message entirely.
 *
 * The returned callback is referentially stable for the lifetime of the
 * mounted runtime.
 *
 * @example
 * ```tsx
 * function AskAgain() {
 *   const sendFollowUp = useSendFollowUp();
 *   return (
 *     <button
 *       type="button"
 *       onClick={() => sendFollowUp({ prompt: "Show more results" })}
 *     >
 *       Refine search
 *     </button>
 *   );
 * }
 * ```
 */
export function useSendFollowUp(): (args: {
  prompt: string;
}) => Promise<void> {
  const runtime = useViewRuntime();
  return useCallback(
    async (args: { prompt: string }) => {
      await runtime.sendMessage({
        role: "user",
        content: [{ type: "text", text: args.prompt }],
      });
    },
    [runtime]
  );
}
