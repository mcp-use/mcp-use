"use client";

import React from "react";
import { cn } from "@/client/lib/utils";

interface ShineBorderProps {
  borderRadius?: number;
  borderWidth?: number;
  shineColor?: string | string[];
  className?: string;
  children: React.ReactNode;
}

export function ShineBorder({
  borderRadius = 24,
  borderWidth = 1,
  shineColor = "#ffffff",
  className,
  children,
  ...props
}: ShineBorderProps) {
  return (
    <div
      style={{
        borderRadius,
        padding: borderWidth,
        background: `linear-gradient(${shineColor}, ${shineColor})`,
        backgroundClip: "padding-box",
      }}
      className={cn(
        "relative",
        "before:absolute before:inset-0 before:rounded-[inherit] before:p-[1px] before:bg-gradient-to-r before:from-transparent before:via-white/20 before:to-transparent before:opacity-0 hover:before:opacity-100 before:transition-opacity before:duration-500",
        className
      )}
      {...props}
    >
      <div
        className="h-full w-full rounded-[inherit] bg-background"
        style={{
          borderRadius: borderRadius - borderWidth,
        }}
      >
        {children}
      </div>
    </div>
  );
}
