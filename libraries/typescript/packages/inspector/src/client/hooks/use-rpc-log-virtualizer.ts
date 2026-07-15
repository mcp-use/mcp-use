import { useCallback, useEffect, useMemo, useState } from "react";

export const RPC_LOG_ROW_HEIGHT = 36;
export const RPC_LOG_EXPANDED_EXTRA = 188;
const OVERSCAN = 6;

export interface RpcLogVirtualSlice<T> {
  totalHeight: number;
  visibleItems: Array<{ index: number; item: T; top: number; height: number }>;
}

export function useRpcLogVirtualizer<T extends { id: string }>(
  items: T[],
  expandedIds: Set<string>,
  scrollRef: React.RefObject<HTMLElement | null>
) {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const layout = useMemo(() => {
    const offsets: number[] = [];
    const heights: number[] = [];
    let totalHeight = 0;

    for (const item of items) {
      offsets.push(totalHeight);
      const height =
        RPC_LOG_ROW_HEIGHT +
        (expandedIds.has(item.id) ? RPC_LOG_EXPANDED_EXTRA : 0);
      heights.push(height);
      totalHeight += height;
    }

    return { offsets, heights, totalHeight };
  }, [expandedIds, items]);

  const slice = useMemo((): RpcLogVirtualSlice<T> => {
    if (items.length === 0) {
      return { totalHeight: 0, visibleItems: [] };
    }

    const { offsets, heights, totalHeight } = layout;
    const viewBottom = scrollTop + viewportHeight;

    let start = 0;
    while (
      start < items.length &&
      offsets[start]! + heights[start]! < scrollTop
    ) {
      start++;
    }
    start = Math.max(0, start - OVERSCAN);

    let end = start;
    while (end < items.length && offsets[end]! < viewBottom) {
      end++;
    }
    end = Math.min(items.length, end + OVERSCAN);

    const visibleItems = [];
    for (let index = start; index < end; index++) {
      visibleItems.push({
        index,
        item: items[index]!,
        top: offsets[index]!,
        height: heights[index]!,
      });
    }

    return { totalHeight, visibleItems };
  }, [items, layout, scrollTop, viewportHeight]);

  const onScroll = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    setScrollTop(node.scrollTop);
  }, [scrollRef]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;

    const measure = () => {
      setViewportHeight(node.clientHeight);
      setScrollTop(node.scrollTop);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    node.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      observer.disconnect();
      node.removeEventListener("scroll", onScroll);
    };
  }, [onScroll, scrollRef, items.length]);

  return slice;
}
