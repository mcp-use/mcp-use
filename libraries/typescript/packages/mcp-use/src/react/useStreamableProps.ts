/**
 * Client-side hook for receiving streamed prop updates from the server.
 *
 * Listens for `mcp-use/notifications/props-update` notifications via the
 * MCP Apps bridge and merges them into React state. Used by generated
 * inline widget entry wrappers.
 *
 * @example
 * ```tsx
 * function Wrapper() {
 *   const { props } = useWidget();
 *   const mergedProps = useStreamableProps(props);
 *   return <MyComponent {...mergedProps} />;
 * }
 * ```
 */

import { useCallback, useEffect, useRef, useState } from "react";

const PROPS_UPDATE_METHOD = "mcp-use/notifications/props-update";

interface PropsUpdateNotification {
  key: string;
  value: unknown;
}

/**
 * Hook that subscribes to streamed prop updates from the server.
 *
 * When a tool handler uses `streamable()` for a prop value, the server
 * sends `mcp-use/notifications/props-update` notifications with `{ key, value }`
 * payloads. This hook merges those updates into the base props from `useWidget()`.
 *
 * @param baseProps - Base props from `useWidget().props`
 * @returns Merged props with streamed updates applied on top
 */
export function useStreamableProps<T extends Record<string, unknown>>(
  baseProps: T
): T {
  const [streamedUpdates, setStreamedUpdates] = useState<
    Record<string, unknown>
  >({});
  const basePropsRef = useRef(baseProps);
  basePropsRef.current = baseProps;

  const handleMessage = useCallback((event: MessageEvent) => {
    if (typeof event.data !== "object" || event.data === null) return;
    const msg = event.data;
    if (msg.method !== PROPS_UPDATE_METHOD) return;

    const params = msg.params as PropsUpdateNotification | undefined;
    if (!params?.key) return;

    setStreamedUpdates((prev) => ({ ...prev, [params.key]: params.value }));
  }, []);

  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleMessage]);

  // Reset streamed updates when base props change (new tool result arrived)
  const prevBaseRef = useRef(baseProps);
  useEffect(() => {
    if (prevBaseRef.current !== baseProps) {
      prevBaseRef.current = baseProps;
      setStreamedUpdates({});
    }
  }, [baseProps]);

  if (Object.keys(streamedUpdates).length === 0) {
    return baseProps;
  }

  return { ...baseProps, ...streamedUpdates } as T;
}

export { PROPS_UPDATE_METHOD };
