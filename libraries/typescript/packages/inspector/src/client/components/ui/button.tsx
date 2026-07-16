"use client";

import {
  cloneElement,
  forwardRef,
  isValidElement,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import type { IconComponent } from "@/client/lib/icon-context";
import { cn } from "@/client/lib/utils";
import { useShape } from "@/client/lib/shape-context";

const buttonVariants = cva(
  [
    "group relative isolate inline-flex items-center justify-center outline-none cursor-pointer",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
    "transition-colors duration-80",
    "disabled:opacity-50 disabled:pointer-events-none",
    "focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]",
  ],
  {
    variants: {
      variant: {
        primary: "text-background",
        secondary: "text-foreground",
        tertiary: "border border-border text-foreground",
        ghost: "text-muted-foreground hover:text-foreground",
        destructive: "text-white",
      },
      size: {
        sm: "h-7 px-3 text-[12px] gap-1 [&_svg:not([class*='size-'])]:size-3.5",
        md: "h-8 px-4 text-[13px] gap-1.5 [&_svg:not([class*='size-'])]:size-4",
        lg: "h-9 px-5 text-[14px] gap-1.5 [&_svg:not([class*='size-'])]:size-4",
        "icon-sm": "h-8 w-8 p-0 [&_svg]:h-3.5 [&_svg]:w-3.5",
        icon: "h-9 w-9 p-0 [&_svg]:h-4 [&_svg]:w-4",
        "icon-lg": "h-10 w-10 p-0 [&_svg]:h-5 [&_svg]:w-5",
      },
      iconLeft: { true: "" },
      iconRight: { true: "" },
    },
    compoundVariants: [
      { size: "sm", iconLeft: true, className: "pl-[6px]" },
      { size: "md", iconLeft: true, className: "pl-[10px]" },
      { size: "lg", iconLeft: true, className: "pl-[14px]" },
      { size: "sm", iconRight: true, className: "pr-[6px]" },
      { size: "md", iconRight: true, className: "pr-[10px]" },
      { size: "lg", iconRight: true, className: "pr-[14px]" },
    ],
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
);

interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "color">,
    Omit<VariantProps<typeof buttonVariants>, "variant" | "size"> {
  variant?: VariantProps<typeof buttonVariants>["variant"] | LegacyButtonVariant;
  size?: VariantProps<typeof buttonVariants>["size"] | LegacyButtonSize;
  /** Render a different element (e.g. anchor) with button styling via Base UI `render`. */
  render?: ReactElement;
  nativeButton?: boolean;
  loading?: boolean;
  leadingIcon?: IconComponent;
  trailingIcon?: IconComponent;
  /** Force the visual pressed/held state. Useful when the button drives an
   *  external open piece of UI (a popover, dropdown, etc.) so it reads as
   *  engaged while the menu is showing. */
  active?: boolean;
}

const bgVariants: Record<string, string> = {
  primary: "bg-foreground group-hover:bg-foreground/90 group-active:bg-foreground/80",
  secondary: "bg-accent group-hover:bg-accent/80 group-active:bg-accent",
  tertiary: "bg-transparent group-hover:bg-hover group-active:bg-active",
  ghost: "bg-transparent group-hover:bg-hover group-active:bg-active",
  destructive:
    "bg-destructive group-hover:bg-destructive/90 group-active:bg-destructive/80",
};

const activeBgVariants: Record<string, string> = {
  primary: "bg-foreground/80",
  secondary: "bg-accent",
  tertiary: "bg-active",
  ghost: "bg-active",
  destructive: "bg-destructive/80",
};

type LegacyButtonVariant =
  | "default"
  | "destructive"
  | "outline"
  | "secondary"
  | "ghost"
  | "link";
type LegacyButtonSize =
  | "default"
  | "xs"
  | "sm"
  | "lg"
  | "icon"
  | "icon-xs"
  | "icon-sm"
  | "icon-lg";

const legacyVariantMap: Record<LegacyButtonVariant, keyof typeof bgVariants> = {
  default: "primary",
  destructive: "destructive",
  outline: "tertiary",
  secondary: "secondary",
  ghost: "ghost",
  link: "ghost",
};

const legacySizeMap: Record<LegacyButtonSize, NonNullable<ButtonProps["size"]>> =
  {
    default: "md",
    xs: "sm",
    sm: "sm",
    lg: "lg",
    icon: "icon",
    "icon-xs": "icon-sm",
    "icon-sm": "icon-sm",
    "icon-lg": "icon-lg",
  };

function isPlainLabel(value: ReactNode): value is string | number {
  return typeof value === "string" || typeof value === "number";
}

function ButtonLabel({ children }: { children: ReactNode }) {
  if (isPlainLabel(children)) {
    return (
      <span className="[text-box:trim-both_cap_alphabetic]">{children}</span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">{children}</span>
  );
}

/** Compact on xs; md height from sm+. Replaces dead `lg:size-default`. */
const buttonToolbarClass =
  "sm:h-8 sm:min-h-8 sm:px-4 sm:text-[13px] sm:[&_svg:not([class*='size-'])]:size-4";

/** Keyboard hint chip — uniform inset on all sides of the pill. */
const buttonShortcutClass =
  "hidden sm:inline shrink-0 text-[10px] leading-none border border-current/30 p-1 rounded-full";

/** Execute/cancel buttons: right inset matches vertical centering (h-7→pr-1, h-8→pr-2). */
const buttonExecuteClass = cn(buttonToolbarClass, "pr-1! sm:pr-2!");

function normalizeButtonProps({
  variant,
  size,
  className,
}: {
  variant?: ButtonProps["variant"] | LegacyButtonVariant;
  size?: ButtonProps["size"] | LegacyButtonSize;
  className?: string;
}) {
  const resolvedVariant =
    variant && variant in legacyVariantMap
      ? legacyVariantMap[variant as LegacyButtonVariant]
      : variant;
  const resolvedSize =
    size && size in legacySizeMap
      ? legacySizeMap[size as LegacyButtonSize]
      : size;

  return {
    variant: resolvedVariant as VariantProps<typeof buttonVariants>["variant"],
    size: resolvedSize as VariantProps<typeof buttonVariants>["size"],
    className: cn(
      resolvedVariant === "ghost" &&
        (variant === "link" ? "underline-offset-4 hover:underline" : undefined),
      className
    ),
  };
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      render,
      nativeButton = true,
      loading = false,
      leadingIcon: LeadingIcon,
      trailingIcon: TrailingIcon,
      active = false,
      disabled,
      children,
      style,
      ...props
    },
    ref
  ) => {
    const normalized = normalizeButtonProps({ variant, size, className });
    variant = normalized.variant;
    size = normalized.size;
    className = normalized.className;

    // Base UI `render`: user's element becomes the root; internals stay as children.
    const renderElement =
      render && isValidElement(render)
        ? (render as ReactElement<{
            children?: ReactNode;
            className?: string;
            style?: React.CSSProperties;
            ref?: React.Ref<HTMLButtonElement>;
          }>)
        : null;
    const label =
      renderElement && renderElement.props.children != null
        ? renderElement.props.children
        : children;
    const isIconOnly = size === "icon" || size === "icon-sm" || size === "icon-lg";
    const iconSize = size === "sm" ? 14 : size === "lg" ? 20 : 16;
    // Spinner box tracks the button height (sm is h-7, lg/icon are h-9, …) so
    // the loading glyph stays proportionate across sizes.
    const spinnerSizeClass =
      size === "sm"
        ? "h-7 w-7"
        : size === "lg" || size === "icon"
          ? "h-9 w-9"
          : size === "icon-lg"
            ? "h-10 w-10"
            : "h-8 w-8";
    const shape = useShape();
    const bgClass = active
      ? activeBgVariants[variant ?? "primary"]
      : bgVariants[variant ?? "primary"];

    const internals = (
      <>
        <span
          aria-hidden
          className={cn(
            "absolute inset-0 rounded-[inherit] transition-[background-color,transform] duration-80 group-active:scale-[0.98]",
            bgClass
          )}
        />
        <span className="relative inline-flex items-center justify-center gap-[inherit]">
          {loading ? (
            <>
              <span className="inline-flex items-center justify-center gap-[inherit] opacity-0">
                {LeadingIcon && !isIconOnly && (
                  <LeadingIcon size={iconSize} strokeWidth={2} />
                )}
                <ButtonLabel>{label}</ButtonLabel>
                {TrailingIcon && !isIconOnly && (
                  <TrailingIcon size={iconSize} strokeWidth={2} />
                )}
              </span>
              <span className="absolute inset-0 flex items-center justify-center">
                <svg
                  className={spinnerSizeClass}
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <path
                    d="M 12 12 C 14 8.5 19 8.5 19 12 C 19 15.5 14 15.5 12 12 C 10 8.5 5 8.5 5 12 C 5 15.5 10 15.5 12 12 Z"
                    stroke="currentColor"
                    strokeWidth="1.125"
                    strokeLinecap="round"
                    pathLength="100"
                    style={{
                      strokeDasharray: "15 85",
                      animation: "spinner-move 2s linear infinite, spinner-dash 4s ease-in-out infinite",
                    }}
                  />
                </svg>
              </span>
            </>
          ) : isIconOnly ? (
            <span className="inline-flex items-center justify-center [&_svg]:stroke-[1.5] [&_svg]:transition-[stroke-width] [&_svg]:duration-80 group-hover:[&_svg]:stroke-[2]">
              {label}
            </span>
          ) : LeadingIcon || TrailingIcon ? (
            <>
              {LeadingIcon && (
                <LeadingIcon
                  size={iconSize}
                  strokeWidth={1.5}
                  className="transition-[stroke-width] duration-80 group-hover:stroke-[2]"
                />
              )}
              <ButtonLabel>{label}</ButtonLabel>
              {TrailingIcon && (
                <TrailingIcon
                  size={iconSize}
                  strokeWidth={1.5}
                  className="transition-[stroke-width] duration-80 group-hover:stroke-[2]"
                />
              )}
            </>
          ) : (
            <ButtonLabel>{label}</ButtonLabel>
          )}
        </span>
      </>
    );

    const rootClassName = cn(
      buttonVariants({
        variant,
        size,
        iconLeft: !isIconOnly && !!LeadingIcon,
        iconRight: !isIconOnly && !!TrailingIcon,
      }),
      shape.button,
      className
    );

    if (renderElement) {
      const childProps = renderElement.props;
      return (
        <ButtonPrimitive
          ref={ref as never}
          render={cloneElement(renderElement, {
            className: cn(rootClassName, childProps.className),
            style: { ...style, ...childProps.style },
          })}
          nativeButton={nativeButton}
          disabled={disabled || loading}
          {...props}
        >
          {internals}
        </ButtonPrimitive>
      );
    }

    return (
      <ButtonPrimitive
        ref={ref as never}
        className={rootClassName}
        disabled={disabled || loading}
        style={style}
        {...props}
      >
        {internals}
      </ButtonPrimitive>
    );
  }
);

Button.displayName = "Button";

export { Button, buttonToolbarClass, buttonShortcutClass, buttonExecuteClass };
