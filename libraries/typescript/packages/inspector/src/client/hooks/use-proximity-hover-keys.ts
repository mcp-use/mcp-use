"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

interface ItemRect {
  top: number;
  height: number;
  left: number;
  width: number;
}

interface UseProximityHoverKeysOptions {
  axis?: "x" | "y";
}

interface UseProximityHoverKeysReturn {
  activeKey: string | null;
  itemRects: Record<string, ItemRect>;
  sessionRef: RefObject<number>;
  handlers: {
    onMouseMove: (e: React.MouseEvent) => void;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
  };
  registerItem: (key: string, element: HTMLElement | null) => void;
  measureItems: () => void;
}

/** Layout position of `element` relative to `container` (handles nested offsetParents). */
function measureRelativeToContainer(
  element: HTMLElement,
  container: HTMLElement
): ItemRect {
  let top = 0;
  let left = 0;
  let node: HTMLElement | null = element;
  while (node && node !== container) {
    top += node.offsetTop;
    left += node.offsetLeft;
    node = node.offsetParent as HTMLElement | null;
  }
  if (node !== container) {
    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    return {
      top: elementRect.top - containerRect.top,
      left: elementRect.left - containerRect.left,
      width: elementRect.width,
      height: elementRect.height,
    };
  }
  return {
    top,
    left,
    width: element.offsetWidth,
    height: element.offsetHeight,
  };
}

function rectsEqual(
  a: Record<string, ItemRect>,
  b: Record<string, ItemRect>
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    const p = a[key];
    const r = b[key];
    if (
      !p ||
      !r ||
      p.top !== r.top ||
      p.left !== r.left ||
      p.width !== r.width ||
      p.height !== r.height
    ) {
      return false;
    }
  }
  return true;
}

/** String-key proximity hover for sidebar nav rows. */
export function useProximityHoverKeys<T extends HTMLElement>(
  containerRef: RefObject<T | null>,
  options: UseProximityHoverKeysOptions = {}
): UseProximityHoverKeysReturn {
  const { axis = "y" } = options;
  const itemsRef = useRef(new Map<string, HTMLElement>());
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [itemRects, setItemRects] = useState<Record<string, ItemRect>>({});
  const itemRectsRef = useRef<Record<string, ItemRect>>({});
  const sessionRef = useRef(0);
  const rafIdRef = useRef<number | null>(null);
  const remeasureRafIdRef = useRef<number | null>(null);

  const measureItems = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const rects: Record<string, ItemRect> = {};
    itemsRef.current.forEach((element, key) => {
      rects[key] = measureRelativeToContainer(element, container);
    });
    if (rectsEqual(itemRectsRef.current, rects)) return;
    itemRectsRef.current = rects;
    setItemRects(rects);
  }, [containerRef]);

  const registerItem = useCallback(
    (key: string, element: HTMLElement | null) => {
      if (element) {
        itemsRef.current.set(key, element);
      } else {
        itemsRef.current.delete(key);
      }
      if (remeasureRafIdRef.current !== null) {
        cancelAnimationFrame(remeasureRafIdRef.current);
      }
      remeasureRafIdRef.current = requestAnimationFrame(() => {
        remeasureRafIdRef.current = null;
        measureItems();
      });
    },
    [measureItems]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const mouseX = e.clientX;
      const mouseY = e.clientY;

      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }

      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        const container = containerRef.current;
        if (!container) return;

        const containerRect = container.getBoundingClientRect();
        const mousePos = axis === "x" ? mouseX : mouseY;

        let closestKey: string | null = null;
        let closestDistance = Infinity;
        let containingKey: string | null = null;

        const rects = itemRectsRef.current;
        const scrollOffset =
          axis === "x" ? container.scrollLeft : container.scrollTop;
        const borderOffset =
          axis === "x" ? container.clientLeft : container.clientTop;
        const containerEdge =
          axis === "x" ? containerRect.left : containerRect.top;
        const layoutSize =
          axis === "x" ? container.offsetWidth : container.offsetHeight;
        const visualSize =
          axis === "x" ? containerRect.width : containerRect.height;
        const scale = layoutSize > 0 ? visualSize / layoutSize : 1;

        for (const [key, r] of Object.entries(rects)) {
          const contentPos = axis === "x" ? r.left : r.top;
          const itemStart =
            containerEdge + (borderOffset + contentPos - scrollOffset) * scale;
          const itemSize = (axis === "x" ? r.width : r.height) * scale;
          const itemEnd = itemStart + itemSize;

          if (mousePos >= itemStart && mousePos <= itemEnd) {
            containingKey = key;
          }

          const itemCenter = itemStart + itemSize / 2;
          const distance = Math.abs(mousePos - itemCenter);

          if (distance < closestDistance) {
            closestDistance = distance;
            closestKey = key;
          }
        }

        setActiveKey(containingKey ?? closestKey);
      });
    },
    [axis, containerRef]
  );

  const handleMouseEnter = useCallback(() => {
    sessionRef.current += 1;
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    setActiveKey(null);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (remeasureRafIdRef.current !== null) {
        cancelAnimationFrame(remeasureRafIdRef.current);
      }
      remeasureRafIdRef.current = requestAnimationFrame(() => {
        remeasureRafIdRef.current = null;
        measureItems();
      });
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [containerRef, measureItems]);

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
      if (remeasureRafIdRef.current !== null)
        cancelAnimationFrame(remeasureRafIdRef.current);
    };
  }, []);

  return {
    activeKey,
    itemRects,
    sessionRef,
    handlers: {
      onMouseMove: handleMouseMove,
      onMouseEnter: handleMouseEnter,
      onMouseLeave: handleMouseLeave,
    },
    registerItem,
    measureItems,
  };
}
