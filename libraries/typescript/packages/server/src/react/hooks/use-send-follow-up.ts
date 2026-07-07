import { useViewActions } from "../bridge/view-bridge.js";

/**
 * Returns a callback that sends a follow-up user message to trigger a model turn.
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
  const { sendFollowUpMessage } = useViewActions();
  return sendFollowUpMessage;
}
