"use client";

import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/client/lib/utils";
import { useShape } from "@/client/lib/shape-context";

const badgeColors = {
  gray: "#a3a3a3",
  red: "#ef4444",
  orange: "#f97316",
  amber: "#f59e0b",
  yellow: "#eab308",
  lime: "#84cc16",
  green: "#22c55e",
  emerald: "#10b981",
  teal: "#14b8a6",
  cyan: "#06b6d4",
  blue: "#3b82f6",
  indigo: "#6366f1",
  violet: "#8b5cf6",
  purple: "#a855f7",
  fuchsia: "#d946ef",
  pink: "#ec4899",
  rose: "#f43f5e",
} as const;

type BadgeColor = keyof typeof badgeColors;

const badgeVariants = cva(
  "inline-flex items-center font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        solid: "",
        outline: "border border-border text-foreground",
      },
      size: {
        sm: "h-5 px-2 text-[11px] gap-1",
        md: "h-6 px-2.5 text-[12px] gap-1.5",
        lg: "h-7 px-3 text-[13px] gap-1.5",
      },
    },
    defaultVariants: {
      variant: "solid",
      size: "md",
    },
  }
);

type LegacyBadgeVariant = "default" | "secondary" | "destructive" | "outline";

const legacyBadgeVariantMap: Record<
  LegacyBadgeVariant,
  { variant: "solid" | "outline"; color: BadgeColor }
> = {
  default: { variant: "solid", color: "blue" },
  secondary: { variant: "solid", color: "green" },
  destructive: { variant: "solid", color: "red" },
  outline: { variant: "outline", color: "gray" },
};

interface BadgeProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, "color">,
    Omit<VariantProps<typeof badgeVariants>, "variant"> {
  color?: BadgeColor;
  variant?: VariantProps<typeof badgeVariants>["variant"] | LegacyBadgeVariant;
}

function isPlainBadgeContent(value: ReactNode): value is string | number {
  return typeof value === "string" || typeof value === "number";
}

function BadgeContent({ children }: { children: ReactNode }) {
  if (isPlainBadgeContent(children)) {
    return (
      <span className="[text-box:trim-both_cap_alphabetic]">{children}</span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">{children}</span>
  );
}

const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  (
    {
      className,
      variant: variantProp = "solid",
      size = "md",
      color: colorProp,
      children,
      style,
      ...props
    },
    ref
  ) => {
    const legacy =
      variantProp && variantProp in legacyBadgeVariantMap
        ? legacyBadgeVariantMap[variantProp as LegacyBadgeVariant]
        : null;
    const variant = (legacy?.variant ??
      variantProp) as VariantProps<typeof badgeVariants>["variant"];
    const color = colorProp ?? legacy?.color ?? "gray";
    const shape = useShape();
    const colorValue = badgeColors[color];
    const isSolid = variant === "solid";

    const colorStyle = isSolid
      ? color === "gray"
        ? { backgroundColor: "var(--accent)", color: "var(--foreground)" }
        : {
            color: "var(--foreground)",
            backgroundColor: `color-mix(in srgb, ${colorValue} 15%, var(--background))`,
          }
      : {};

    return (
      <span
        ref={ref}
        className={cn(badgeVariants({ variant, size }), shape.item, className)}
        style={{ ...colorStyle, ...style }}
        {...props}
      >
        <BadgeContent>{children}</BadgeContent>
      </span>
    );
  }
);

Badge.displayName = "Badge";

export { Badge };
