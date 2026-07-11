import { useViewActions } from "../bridge/view-bridge.js";

/**
 * Returns a callback that notifies the host of the view's size via
 * `ui/notifications/size-changed`.
 *
 * Pair with `viewConfig.autoResize: false` when the view's height derives from
 * its width (for example a fixed aspect-ratio container). Ext-apps auto-resize
 * measures the document under `height: max-content`, which collapses those
 * layouts; disable it and report `{ width, height }` from a `ResizeObserver`
 * (or equivalent) instead.
 *
 * @example
 * ```tsx
 * import {
 *   ThemeProvider,
 *   useSendSizeChanged,
 *   type ViewConfig,
 * } from "@mcp-use/server/react";
 * import { useEffect, useRef } from "react";
 *
 * export const viewConfig = {
 *   autoResize: false,
 *   displayModes: ["inline", "fullscreen"],
 * } satisfies ViewConfig;
 *
 * export default function AspectRatioView() {
 *   return (
 *     <ThemeProvider>
 *       <AspectRatioContent />
 *     </ThemeProvider>
 *   );
 * }
 *
 * function AspectRatioContent() {
 *   const ref = useRef<HTMLDivElement>(null);
 *   const sendSizeChanged = useSendSizeChanged();
 *
 *   useEffect(() => {
 *     const element = ref.current;
 *     if (!element) return;
 *
 *     const observer = new ResizeObserver(([entry]) => {
 *       if (!entry) return;
 *       const { width, height } = entry.contentRect;
 *       void sendSizeChanged({ width, height });
 *     });
 *
 *     observer.observe(element);
 *     return () => observer.disconnect();
 *   }, [sendSizeChanged]);
 *
 *   return <div ref={ref} style={{ width: "100%", aspectRatio: "4 / 3" }} />;
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
