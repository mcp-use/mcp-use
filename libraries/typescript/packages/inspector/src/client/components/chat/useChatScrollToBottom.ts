import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

interface UseChatScrollToBottomOptions {
  messageCount: number;
  isLoading: boolean;
  enabled?: boolean;
}

export function useChatScrollToBottom(
  scrollContainerRef: RefObject<HTMLElement | null>,
  { messageCount, isLoading, enabled = true }: UseChatScrollToBottomOptions
) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [showTopFade, setShowTopFade] = useState(false);
  const isNearBottomRef = useRef(true);
  const prevScrollTriggerRef = useRef({ length: 0, loading: false });
  const bottomThresholdPx = 64;
  const topFadeThresholdPx = 8;

  const hasMessages = messageCount > 0;
  const showScrollToBottom = enabled && hasMessages && !isNearBottom;

  const measureIsNearBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom =
      el.scrollHeight - (el.scrollTop + el.clientHeight);
    const near = distanceFromBottom <= bottomThresholdPx;
    isNearBottomRef.current = near;
    setIsNearBottom(near);
    setShowTopFade(el.scrollTop > topFadeThresholdPx);
  }, [scrollContainerRef]);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior) => {
      const el = scrollContainerRef.current;
      if (!el) return;

      el.scrollTo({ top: el.scrollHeight, behavior });
      isNearBottomRef.current = true;
      setIsNearBottom(true);
    },
    [scrollContainerRef]
  );

  useEffect(() => {
    if (!enabled) return;

    const el = scrollContainerRef.current;
    if (!el) return;

    measureIsNearBottom();
    const onScroll = () => measureIsNearBottom();
    el.addEventListener("scroll", onScroll, { passive: true });

    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => measureIsNearBottom())
        : null;
    ro?.observe(el);

    return () => {
      el.removeEventListener("scroll", onScroll);
      ro?.disconnect();
    };
  }, [enabled, measureIsNearBottom, messageCount, scrollContainerRef]);

  useEffect(() => {
    if (!enabled || !hasMessages) return;
    if (!isNearBottomRef.current) return;

    const prev = prevScrollTriggerRef.current;
    const lengthChanged = messageCount !== prev.length;
    const loadingChanged = isLoading !== prev.loading;
    prevScrollTriggerRef.current = {
      length: messageCount,
      loading: isLoading,
    };

    if (!lengthChanged && !loadingChanged) return;

    scrollToBottom(isLoading ? "auto" : "smooth");
  }, [enabled, hasMessages, isLoading, messageCount, scrollToBottom]);

  return { messagesEndRef, showScrollToBottom, showTopFade, scrollToBottom };
}
