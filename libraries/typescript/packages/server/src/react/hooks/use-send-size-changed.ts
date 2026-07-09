import { useViewActions } from "../bridge/view-bridge.js";

/**
 * Returns a callback that notifies the host of the view's size via
 * `ui/notifications/size-changed`.
 *
 * Pair with {@link McpUseProvider} `autoSize={false}` when the view's height
 * derives from its width (for example a fixed aspect-ratio container).
 * Ext-apps auto-resize measures the document under `height: max-content`,
 * which collapses those layouts; disable it and report `{ width, height }`
 * from a `ResizeObserver` (or equivalent) instead.
 *
 * @example
 * ```tsx
 * import { useEffect, useRef } from "react";
 * import { McpUseProvider, useSendSizeChanged } from "@mcp-use/server/react";
 *
 * export default function AspectRatioView() {
 *   return (
 *     <McpUseProvider autoSize={false}>
 *       <AspectRatioInner />
 *     </McpUseProvider>
 *   );
 * }
 *
 * function AspectRatioInner() {
 *   const sendSizeChanged = useSendSizeChanged();
 *   const ref = useRef<HTMLDivElement>(null);
 *
 *   useEffect(() => {
 *     const el = ref.current;
 *     if (!el) return;
 *     const ro = new ResizeObserver(([entry]) => {
 *       const { width, height } = entry.contentRect;
 *       void sendSizeChanged({ width, height });
 *     });
 *     ro.observe(el);
 *     return () => ro.disconnect();
 *   }, [sendSizeChanged]);
 *
 *   return <div ref={ref} style={{ aspectRatio: "4 / 3", width: "100%" }} />;
 * }
 * ```
 */
export function useSendSizeChanged(): (size: {
  width?: number;
  height?: number;
}) => Promise<void> {
  const { sendSizeChanged } = useViewActions();
  return sendSizeChanged;
}
