"use client";

import {
  forwardRef,
  useRef,
  useState,
  useEffect,
  useCallback,
  useId,
  type HTMLAttributes,
} from "react";
import { motion, useMotionValue, animate, type Transition } from "motion/react";
import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "@/client/lib/utils";
import { spring } from "@/client/lib/springs";

const TRACK_WIDTH = 34;
const TRACK_HEIGHT = 20;
const THUMB_SIZE = 16;
const THUMB_OFFSET = 2;
const THUMB_TRAVEL = TRACK_WIDTH - THUMB_SIZE - THUMB_OFFSET * 2;
const PILL_EXTEND = 2;
const PRESS_EXTEND = 4;
const PRESS_SHRINK = 4;
const DRAG_DEAD_ZONE = 2;

interface FluidSwitchProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
  thumbTransition?: Transition;
}

interface ShadcnSwitchProps
  extends Omit<HTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
}

type SwitchProps = FluidSwitchProps | ShadcnSwitchProps;

function isFluidSwitchProps(props: SwitchProps): props is FluidSwitchProps {
  return "label" in props && typeof props.label === "string";
}

const FluidSwitch = forwardRef<HTMLDivElement, FluidSwitchProps>(
  (
    { label, checked, onToggle, disabled = false, thumbTransition, className, ...props },
    ref
  ) => {
    const labelId = useId();
    const hasMounted = useRef(false);
    const [hovered, setHovered] = useState(false);
    const [pressed, setPressed] = useState(false);

    const dragging = useRef(false);
    const didDrag = useRef(false);
    const pointerStart = useRef<{
      clientX: number;
      originX: number;
    } | null>(null);

    const motionX = useMotionValue(
      checked ? THUMB_OFFSET + THUMB_TRAVEL : THUMB_OFFSET
    );

    useEffect(() => {
      hasMounted.current = true;
    }, []);

    const thumbWidth = pressed
      ? THUMB_SIZE + PRESS_EXTEND
      : hovered
        ? THUMB_SIZE + PILL_EXTEND
        : THUMB_SIZE;
    const thumbHeight = pressed ? THUMB_SIZE - PRESS_SHRINK : THUMB_SIZE;
    const thumbY = pressed ? THUMB_OFFSET + PRESS_SHRINK / 2 : THUMB_OFFSET;
    const extraWidth = thumbWidth - THUMB_SIZE;
    const thumbX = checked
      ? THUMB_OFFSET + THUMB_TRAVEL - extraWidth
      : THUMB_OFFSET;

    useEffect(() => {
      if (dragging.current) return;
      if (!hasMounted.current) {
        motionX.set(thumbX);
      } else {
        animate(motionX, thumbX, thumbTransition ?? spring.moderate);
      }
    }, [thumbX, motionX, thumbTransition]);

    const handlePointerDown = useCallback(
      (e: React.PointerEvent<HTMLDivElement>) => {
        if (disabled) return;
        if (e.pointerType === "mouse" && e.button !== 0) return;
        setPressed(true);
        dragging.current = false;
        didDrag.current = false;
        pointerStart.current = {
          clientX: e.clientX,
          originX: motionX.get(),
        };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      },
      [disabled, motionX]
    );

    const handlePointerMove = useCallback(
      (e: React.PointerEvent<HTMLDivElement>) => {
        if (!pointerStart.current) return;
        const delta = e.clientX - pointerStart.current.clientX;

        if (!dragging.current) {
          if (Math.abs(delta) < DRAG_DEAD_ZONE) return;
          dragging.current = true;
        }

        const dragMin = THUMB_OFFSET;
        const pressedThumbWidth = THUMB_SIZE + PRESS_EXTEND;
        const dragMax = TRACK_WIDTH - THUMB_OFFSET - pressedThumbWidth;
        const rawX = pointerStart.current.originX + delta;
        motionX.set(Math.max(dragMin, Math.min(dragMax, rawX)));
      },
      [motionX]
    );

    const finishPointer = useCallback(
      (snapOnDragEnd: boolean) => {
        if (!pointerStart.current) return;
        setPressed(false);

        if (dragging.current) {
          didDrag.current = true;
          dragging.current = false;

          if (snapOnDragEnd) {
            const currentX = motionX.get();
            const dragMin = THUMB_OFFSET;
            const pressedThumbWidth = THUMB_SIZE + PRESS_EXTEND;
            const dragMax = TRACK_WIDTH - THUMB_OFFSET - pressedThumbWidth;
            const midpoint = (dragMin + dragMax) / 2;
            const shouldBeOn = currentX > midpoint;

            if (shouldBeOn !== checked) {
              onToggle();
            } else {
              const snapTarget = checked
                ? THUMB_OFFSET + THUMB_TRAVEL
                : THUMB_OFFSET;
              animate(motionX, snapTarget, thumbTransition ?? spring.moderate);
            }
          }

          requestAnimationFrame(() => {
            didDrag.current = false;
          });
        }

        pointerStart.current = null;
      },
      [checked, onToggle, motionX, thumbTransition]
    );

    return (
      <div
        ref={ref}
        className={cn(
          "relative z-10 flex items-center gap-2.5 px-3 py-2 cursor-pointer select-none touch-none",
          disabled && "opacity-50 pointer-events-none",
          className
        )}
        onPointerEnter={(e) => {
          if (e.pointerType === "mouse") setHovered(true);
        }}
        onPointerLeave={() => setHovered(false)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={() => finishPointer(true)}
        onPointerCancel={() => {
          if (!pointerStart.current) return;
          setPressed(false);
          if (dragging.current) {
            dragging.current = false;
            const snapTarget = checked
              ? THUMB_OFFSET + THUMB_TRAVEL
              : THUMB_OFFSET;
            animate(motionX, snapTarget, thumbTransition ?? spring.moderate);
          }
          pointerStart.current = null;
        }}
        onClick={() => {
          if (disabled || didDrag.current) return;
          onToggle();
        }}
        {...props}
      >
        <SwitchPrimitive.Root
          checked={checked}
          aria-labelledby={labelId}
          onCheckedChange={() => {
            if (didDrag.current) return;
            onToggle();
          }}
          disabled={disabled}
          tabIndex={0}
          className={cn(
            "relative shrink-0 rounded-full outline-none cursor-pointer",
            "transition-colors duration-80",
            "focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)] focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          )}
          style={{
            width: TRACK_WIDTH,
            height: TRACK_HEIGHT,
            backgroundColor: checked
              ? hovered
                ? "#5C89F2"
                : "#6B97FF"
              : hovered
                ? "color-mix(in oklab, var(--accent), rgb(var(--overlay)) 10%)"
                : "var(--accent)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <SwitchPrimitive.Thumb
            render={(props) => {
              const {
                style: baseStyle,
                onDrag: _onDrag,
                onDragStart: _onDragStart,
                onDragEnd: _onDragEnd,
                onAnimationStart: _onAnimationStart,
                onAnimationEnd: _onAnimationEnd,
                onAnimationIteration: _onAnimationIteration,
                ...rest
              } = props as React.HTMLAttributes<HTMLSpanElement>;
              return (
                <motion.span
                  {...rest}
                  className="absolute top-0 left-0 block rounded-full bg-white shadow-sm"
                  initial={false}
                  style={{
                    ...(baseStyle as React.CSSProperties | undefined),
                    x: motionX,
                  }}
                  animate={{
                    y: thumbY,
                    width: thumbWidth,
                    height: thumbHeight,
                  }}
                  transition={
                    hasMounted.current ? (thumbTransition ?? spring.moderate) : { duration: 0 }
                  }
                />
              );
            }}
          />
        </SwitchPrimitive.Root>

        <span
          id={labelId}
          className={cn(
            "text-[13px] [text-box:trim-both_cap_alphabetic] transition-[color] duration-80",
            checked ? "text-foreground" : "text-muted-foreground"
          )}
        >
          {label}
        </span>
      </div>
    );
  }
);
FluidSwitch.displayName = "FluidSwitch";

const ShadcnSwitch = forwardRef<HTMLButtonElement, ShadcnSwitchProps>(
  (
    {
      checked,
      defaultChecked = false,
      onCheckedChange,
      disabled = false,
      className,
    },
    ref
  ) => {
    const [internalChecked, setInternalChecked] = useState(defaultChecked);
    const isChecked = checked ?? internalChecked;

    const setChecked = (next: boolean) => {
      if (checked === undefined) {
        setInternalChecked(next);
      }
      onCheckedChange?.(next);
    };

    return (
      <SwitchPrimitive.Root
        ref={ref}
        checked={isChecked}
        disabled={disabled}
        onCheckedChange={setChecked}
        className={cn(
          "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-xs transition-colors duration-80",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "data-checked:bg-primary data-unchecked:bg-input",
          className
        )}
      >
        <SwitchPrimitive.Thumb
          className={cn(
            "pointer-events-none block size-4 rounded-full bg-background shadow-sm ring-0 transition-transform duration-80",
            "data-checked:translate-x-4 data-unchecked:translate-x-0"
          )}
        />
      </SwitchPrimitive.Root>
    );
  }
);
ShadcnSwitch.displayName = "ShadcnSwitch";

const Switch = forwardRef<HTMLDivElement | HTMLButtonElement, SwitchProps>(
  (props, ref) => {
    if (isFluidSwitchProps(props)) {
      return <FluidSwitch ref={ref as React.Ref<HTMLDivElement>} {...props} />;
    }
    return (
      <ShadcnSwitch ref={ref as React.Ref<HTMLButtonElement>} {...props} />
    );
  }
);
Switch.displayName = "Switch";

export { Switch, FluidSwitch };
export type { SwitchProps, FluidSwitchProps, ShadcnSwitchProps };
