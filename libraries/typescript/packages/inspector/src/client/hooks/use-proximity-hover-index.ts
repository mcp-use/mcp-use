import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";

interface ItemRect {
  top: number;
  height: number;
  left: number;
  width: number;
}

interface UseProximityHoverOptions {
  axis?: "x" | "y";
}

interface UseProximityHoverReturn {
  activeIndex: number | null;
  setActiveIndex: Dispatch<SetStateAction<number | null>>;
  itemRects: ItemRect[];
  sessionRef: RefObject<number>;
  handlers: {
    onMouseMove: (e: React.MouseEvent) => void;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
  };
  registerItem: (index: number, element: HTMLElement | null) => void;
  measureItems: () => void;
}

function getContainerScale(container: HTMLElement, axis: "x" | "y") {
  const containerRect = container.getBoundingClientRect();
  const layoutSize =
    axis === "x" ? container.offsetWidth : container.offsetHeight;
  const visualSize = axis === "x" ? containerRect.width : containerRect.height;
  return layoutSize > 0 ? visualSize / layoutSize : 1;
}

function measureRectsInContainer(
  container: HTMLElement,
  items: Map<number, HTMLElement>
): ItemRect[] {
  const containerRect = container.getBoundingClientRect();
  const scaleX = getContainerScale(container, "x");
  const scaleY = getContainerScale(container, "y");
  const rects: ItemRect[] = [];

  items.forEach((element, index) => {
    const elementRect = element.getBoundingClientRect();
    rects[index] = {
      top: (elementRect.top - containerRect.top) / scaleY + container.scrollTop,
      left:
        (elementRect.left - containerRect.left) / scaleX + container.scrollLeft,
      width: element.offsetWidth,
      height: element.offsetHeight,
    };
  });

  return rects;
}

function resolveActiveIndexFromPointer(
  items: Map<number, HTMLElement>,
  clientX: number,
  clientY: number,
  axis: "x" | "y"
): number | null {
  const mousePos = axis === "x" ? clientX : clientY;
  let closestIndex: number | null = null;
  let closestDistance = Infinity;
  let containingIndex: number | null = null;

  items.forEach((element, index) => {
    const rect = element.getBoundingClientRect();
    const itemStart = axis === "x" ? rect.left : rect.top;
    const itemEnd = axis === "x" ? rect.right : rect.bottom;

    if (mousePos >= itemStart && mousePos <= itemEnd) {
      containingIndex = index;
    }

    const itemCenter = (itemStart + itemEnd) / 2;
    const distance = Math.abs(mousePos - itemCenter);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  });

  return containingIndex ?? closestIndex;
}

function rectsChanged(prev: ItemRect[], next: ItemRect[]) {
  if (prev.length !== next.length) return true;
  for (let i = 0; i < next.length; i++) {
    const p = prev[i];
    const r = next[i];
    if (p === r) continue;
    if (
      !p ||
      !r ||
      p.top !== r.top ||
      p.left !== r.left ||
      p.width !== r.width ||
      p.height !== r.height
    ) {
      return true;
    }
  }
  return false;
}

/** Numeric-index proximity hover (ported from fluidfunctionalism.com/r/use-proximity-hover.json). */
export function useProximityHoverIndex<T extends HTMLElement>(
  containerRef: RefObject<T | null>,
  options: UseProximityHoverOptions = {}
): UseProximityHoverReturn {
  const { axis = "y" } = options;
  const itemsRef = useRef(new Map<number, HTMLElement>());
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [itemRects, setItemRects] = useState<ItemRect[]>([]);
  const itemRectsRef = useRef<ItemRect[]>([]);
  const sessionRef = useRef(0);
  const rafIdRef = useRef<number | null>(null);
  const remeasureRafIdRef = useRef<number | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);

  const measureItems = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const rects = measureRectsInContainer(container, itemsRef.current);
    if (!rectsChanged(itemRectsRef.current, rects)) return;
    itemRectsRef.current = rects;
    setItemRects(rects);
  }, [containerRef]);

  const updateActiveFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      setActiveIndex(
        resolveActiveIndexFromPointer(itemsRef.current, clientX, clientY, axis)
      );
    },
    [axis]
  );

  const registerItem = useCallback(
    (index: number, element: HTMLElement | null) => {
      if (element) {
        itemsRef.current.set(index, element);
      } else {
        itemsRef.current.delete(index);
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
      lastPointerRef.current = { x: e.clientX, y: e.clientY };

      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }

      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        measureItems();
        updateActiveFromPointer(e.clientX, e.clientY);
      });
    },
    [measureItems, updateActiveFromPointer]
  );

  const handleMouseEnter = useCallback(() => {
    sessionRef.current += 1;
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    lastPointerRef.current = null;
    setActiveIndex(null);
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
    const container = containerRef.current;
    if (!container) return;

    const onScroll = () => {
      measureItems();
      const last = lastPointerRef.current;
      if (last) {
        updateActiveFromPointer(last.x, last.y);
      }
    };

    container.addEventListener("scroll", onScroll, {
      capture: true,
      passive: true,
    });
    return () =>
      container.removeEventListener("scroll", onScroll, { capture: true });
  }, [containerRef, measureItems, updateActiveFromPointer]);

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
      if (remeasureRafIdRef.current !== null)
        cancelAnimationFrame(remeasureRafIdRef.current);
    };
  }, []);

  return {
    activeIndex,
    setActiveIndex,
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
