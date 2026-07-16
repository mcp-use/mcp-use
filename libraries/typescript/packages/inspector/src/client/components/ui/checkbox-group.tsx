"use client";

import {
  useRef,
  useEffect,
  createContext,
  useContext,
  forwardRef,
  type ReactNode,
  type HTMLAttributes,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { cn } from "@/client/lib/utils";
import { fontWeights } from "@/client/lib/font-weight";
import { useProximityHover } from "@/client/hooks/use-proximity-hover";
import { useShape } from "@/client/lib/shape-context";

interface CheckboxGroupContextValue {
  registerItem: (index: number, element: HTMLElement | null) => void;
  activeIndex: number | null;
}

const CheckboxGroupContext = createContext<CheckboxGroupContextValue | null>(
  null
);

function useCheckboxGroup() {
  const ctx = useContext(CheckboxGroupContext);
  if (!ctx) {
    throw new Error("useCheckboxGroup must be used within a CheckboxGroup");
  }
  return ctx;
}

interface CheckboxGroupProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  checkedIndices: Set<number>;
  orientation?: "horizontal" | "vertical";
}

const CheckboxGroup = forwardRef<HTMLDivElement, CheckboxGroupProps>(
  (
    {
      children,
      checkedIndices: _checkedIndices,
      orientation = "vertical",
      className,
      ...props
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const isHorizontal = orientation === "horizontal";

    const {
      activeIndex,
      setActiveIndex,
      handlers,
      registerItem,
      measureItems,
    } = useProximityHover(containerRef, {
      axis: isHorizontal ? "x" : "y",
    });

    useEffect(() => {
      measureItems();
    }, [measureItems, children]);

    const prevKey = isHorizontal ? "ArrowLeft" : "ArrowUp";
    const nextKey = isHorizontal ? "ArrowRight" : "ArrowDown";

    return (
      <CheckboxGroupContext.Provider value={{ registerItem, activeIndex }}>
        <div
          ref={(node) => {
            (
              containerRef as React.MutableRefObject<HTMLDivElement | null>
            ).current = node;
            if (typeof ref === "function") ref(node);
            else if (ref) {
              (ref as React.MutableRefObject<HTMLDivElement | null>).current =
                node;
            }
          }}
          onMouseEnter={handlers.onMouseEnter}
          onMouseMove={handlers.onMouseMove}
          onMouseLeave={handlers.onMouseLeave}
          onFocus={(e) => {
            const indexAttr = (e.target as HTMLElement)
              .closest("[data-proximity-index]")
              ?.getAttribute("data-proximity-index");
            if (indexAttr != null) {
              setActiveIndex(Number(indexAttr));
            }
          }}
          onBlur={(e) => {
            if (containerRef.current?.contains(e.relatedTarget as Node)) return;
            setActiveIndex(null);
          }}
          onKeyDown={(e) => {
            const items = Array.from(
              containerRef.current?.querySelectorAll(
                "[data-proximity-index]"
              ) ?? []
            ) as HTMLElement[];
            const currentIdx = items.indexOf(e.target as HTMLElement);
            if (currentIdx === -1) return;

            if ([prevKey, nextKey].includes(e.key)) {
              e.preventDefault();
              const next =
                e.key === nextKey
                  ? (currentIdx + 1) % items.length
                  : (currentIdx - 1 + items.length) % items.length;
              items[next]?.focus();
            } else if (e.key === "Home") {
              e.preventDefault();
              items[0]?.focus();
            } else if (e.key === "End") {
              e.preventDefault();
              items[items.length - 1]?.focus();
            }
          }}
          role="group"
          className={cn(
            "relative flex max-w-full select-none",
            isHorizontal ? "w-auto flex-row" : "w-72 flex-col",
            className
          )}
          {...props}
        >
          {children}
        </div>
      </CheckboxGroupContext.Provider>
    );
  }
);

CheckboxGroup.displayName = "CheckboxGroup";

interface CheckboxItemProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  index: number;
  checked: boolean;
  onToggle: () => void;
  size?: "default" | "sm";
}

const CheckboxItem = forwardRef<HTMLDivElement, CheckboxItemProps>(
  (
    { label, index, checked, onToggle, size = "default", className, ...props },
    ref
  ) => {
    const internalRef = useRef<HTMLDivElement>(null);
    const hasMounted = useRef(false);
    const { registerItem, activeIndex } = useCheckboxGroup();

    useEffect(() => {
      registerItem(index, internalRef.current);
      return () => registerItem(index, null);
    }, [index, registerItem]);

    useEffect(() => {
      hasMounted.current = true;
    }, []);

    const isActive = activeIndex === index;
    const skipAnimation = !hasMounted.current;
    const shape = useShape();
    const isSm = size === "sm";

    return (
      <div
        ref={(node) => {
          (
            internalRef as React.MutableRefObject<HTMLDivElement | null>
          ).current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) {
            (ref as React.MutableRefObject<HTMLDivElement | null>).current =
              node;
          }
        }}
        data-proximity-index={index}
        tabIndex={0}
        role="checkbox"
        aria-checked={checked}
        aria-label={label}
        onClick={onToggle}
        onMouseDown={(e) => {
          const interactive = (e.target as HTMLElement).closest(
            'button:not([tabindex="-1"]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          );
          if (interactive && interactive !== e.currentTarget) return;
          e.preventDefault();
          e.currentTarget.focus();
        }}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            onToggle();
          }
        }}
        className={cn(
          "relative z-10 flex items-center cursor-pointer outline-none",
          isSm ? "h-7 gap-1.5 px-2" : "h-8 gap-2.5 px-3",
          shape.item,
          "focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]",
          className
        )}
        {...props}
      >
        <CheckboxPrimitive.Root
          checked={checked}
          tabIndex={-1}
          aria-hidden
          className={cn(
            "pointer-events-none relative shrink-0 appearance-none bg-transparent p-0 border-0 outline-none",
            isSm ? "size-[13px]" : "size-[15px]"
          )}
        >
          <div
            className={cn(
              "absolute inset-0 rounded-[5px] border-solid transition-all duration-80 border-[1.5px]",
              checked
                ? "border-border"
                : isActive
                  ? "border-neutral-400 dark:border-neutral-500"
                  : "border-border"
            )}
          />
          <AnimatePresence>
            {checked && (
              <CheckboxPrimitive.Indicator
                keepMounted
                render={(indicatorProps) => {
                  const {
                    style: _s,
                    onDrag: _onDrag,
                    onDragStart: _onDragStart,
                    onDragEnd: _onDragEnd,
                    onAnimationStart: _onAnimationStart,
                    onAnimationEnd: _onAnimationEnd,
                    onAnimationIteration: _onAnimationIteration,
                    ...rest
                  } = indicatorProps as React.HTMLAttributes<SVGElement>;
                  return (
                    <motion.svg
                      {...rest}
                      width={isSm ? 14 : 18}
                      height={isSm ? 14 : 18}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-foreground"
                      initial={{ opacity: 1 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 1 }}
                    >
                      <motion.path
                        d="M6 12L10 16L18 8"
                        initial={{ pathLength: skipAnimation ? 1 : 0 }}
                        animate={{
                          pathLength: 1,
                          transition: { duration: 0.08, ease: "easeOut" },
                        }}
                        exit={{
                          pathLength: 0,
                          transition: { duration: 0.04, ease: "easeIn" },
                        }}
                      />
                    </motion.svg>
                  );
                }}
              />
            )}
          </AnimatePresence>
        </CheckboxPrimitive.Root>

        <span className="inline-grid items-center self-center leading-none">
          <span
            className="col-start-1 row-start-1 invisible leading-none"
            style={{ fontVariationSettings: fontWeights.semibold }}
            aria-hidden="true"
          >
            {label}
          </span>
          <span
            className={cn(
              "col-start-1 row-start-1 leading-none transition-[color,font-variation-settings] duration-80",
              isSm ? "text-[11px]" : "text-[13px]",
              checked || isActive ? "text-foreground" : "text-muted-foreground"
            )}
            style={{
              fontVariationSettings: checked
                ? fontWeights.semibold
                : fontWeights.normal,
            }}
          >
            {label}
          </span>
        </span>
      </div>
    );
  }
);

CheckboxItem.displayName = "CheckboxItem";

export { CheckboxGroup, CheckboxItem };
