"use client";

import type { ReactNode } from "react";
import { useId, useMemo } from "react";
import { cn } from "@/client/lib/utils";

// Simple hash function to convert a string to a number
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

// Seeded random number generator (simple LCG)
function seededRandom(seed: number, index: number = 0): number {
  const x = Math.sin(seed + index) * 10000;
  return x - Math.floor(x);
}

export interface RandomGradientBackgroundProps {
  className?: string;
  children?: ReactNode;
  grayscaled?: boolean;
  color?: string | null; // oklch(hue lightness saturation)
  seed?: string; // Optional seed for deterministic gradient
}

export function RandomGradientBackground({
  className,
  color,
  children,
  grayscaled = false,
  seed,
}: RandomGradientBackgroundProps) {
  const fallbackSeed = useId();
  const seedHash = useMemo(() => {
    return seed ? hashString(seed) : hashString(fallbackSeed);
  }, [seed, fallbackSeed]);

  const saturation = useMemo(() => {
    if (color) {
      const values = color.split("(")[1].split(")")[0].trim().split(/\s+/);
      return Number.parseFloat(values[1] || "0");
    }
    return grayscaled ? 0 : 0.2;
  }, [color, grayscaled]);

  const lightness = useMemo(() => {
    if (color) {
      const values = color.split("(")[1].split(")")[0].trim().split(/\s+/);
      return Number.parseFloat(values[0] || "0.5");
    }
    return grayscaled ? 0.3 : 0.4;
  }, [color, grayscaled]);

  const randomHue = useMemo(() => {
    if (color) {
      const values = color.split("(")[1].split(")")[0].trim().split(/\s+/);
      return Number.parseFloat(values[2] || "0");
    }
    return Math.floor(seededRandom(seedHash, 0) * 360);
  }, [color, seedHash]);

  const randomColor = useMemo(() => {
    if (color) {
      return color;
    }
    return `oklch(${Math.min(lightness, 1)} ${saturation} ${randomHue})`;
  }, [randomHue, saturation, lightness]);

  const lightColor = useMemo(() => {
    return `oklch(${Math.min(lightness * 2, 1)} ${saturation} ${randomHue})`;
  }, [randomHue, saturation, lightness, color]);

  const direction = useMemo(() => {
    return Math.floor(seededRandom(seedHash, 1) * 360);
  }, [seedHash]);

  const brightnessFilter = useMemo(() => {
    return "1000%";
  }, []);

  return (
    <section
      className={cn("relative w-full h-full overflow-hidden", className)}
      style={{
        background: `${lightColor}`,
      }}
    >
      <div className="isolate relative w-full h-full">
        <div
          className="noise w-full h-full"
          style={{
            background: `linear-gradient(${direction}deg, ${randomColor}, transparent), url(https://grainy-gradients.vercel.app/noise.svg)`,
            filter: `contrast(120%) brightness(${brightnessFilter})`,
          }}
        />
        {children && (
          <div className="relative z-10 w-full h-full">{children}</div>
        )}
      </div>
    </section>
  );
}
