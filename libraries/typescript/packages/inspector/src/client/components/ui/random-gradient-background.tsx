"use client";

import type { ReactNode } from "react";
import { useId, useMemo } from "react";
import { cn } from "@/client/lib/utils";

/** Coarse grain — reads well on small avatars and icons. */
const NOISE_DATA_URL =
  "data:image/svg+xml,%3Csvg%20viewBox%3D%270%200%20400%20310%27%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%3E%3Cfilter%20id%3D%27noiseFilter%27%3E%3CfeTurbulence%20type%3D%27fractalNoise%27%20baseFrequency%3D%270.083%27%20numOctaves%3D%273%27%20stitchTiles%3D%27stitch%27%2F%3E%3C%2Ffilter%3E%3Crect%20width%3D%27100%25%27%20height%3D%27100%25%27%20filter%3D%27url(%23noiseFilter)%27%2F%3E%3C%2Fsvg%3E";

/** Finer grain for large surfaces (e.g. agent tiles) so the texture does not look oversized. */
const NOISE_DATA_URL_FINE =
  "data:image/svg+xml,%3Csvg%20viewBox%3D%270%200%20400%20310%27%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%3E%3Cfilter%20id%3D%27noiseFilter%27%3E%3CfeTurbulence%20type%3D%27fractalNoise%27%20baseFrequency%3D%270.42%27%20numOctaves%3D%273%27%20stitchTiles%3D%27stitch%27%2F%3E%3C%2Ffilter%3E%3Crect%20width%3D%27100%25%27%20height%3D%27100%25%27%20filter%3D%27url(%23noiseFilter)%27%2F%3E%3C%2Fsvg%3E";

/** Fine turbulence for mesh-gradient composite overlays (inspector connect background). */
export const MESH_PANEL_FINE_OVERLAY_NOISE_DATA_URL = NOISE_DATA_URL_FINE;

/** Hash string to a non-negative 32-bit int (shared for deterministic UI seeds). */
export function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/** Deterministic pseudo-random in [0, 1) from integer seed and optional index. */
export function seededRandom(seed: number, index: number = 0): number {
  const x = Math.sin(seed + index) * 10000;
  return x - Math.floor(x);
}

export interface RandomGradientBackgroundProps {
  className?: string;
  children?: ReactNode;
  grayscaled?: boolean;
  color?: string | null; // oklch(lightness chroma hue)
  seed?: string; // Optional seed for deterministic gradient
  /** Large areas: same colors as default, higher-frequency noise only. */
  variant?: "default" | "tile";
}

export function RandomGradientBackground({
  className,
  color,
  children,
  grayscaled = false,
  seed,
  variant = "default",
}: RandomGradientBackgroundProps) {
  const fallbackSeed = useId();
  const seedHash = useMemo(() => {
    if (seed) return hashString(seed);
    if (color) return hashString(color);
    return hashString(fallbackSeed);
  }, [seed, color, fallbackSeed]);

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
  }, [randomHue, saturation, lightness, color]);

  const lightColor = useMemo(() => {
    return `oklch(${Math.min(lightness * 2, 1)} ${saturation} ${randomHue})`;
  }, [randomHue, saturation, lightness, color]);

  const direction = useMemo(() => {
    return Math.floor(seededRandom(seedHash, 1) * 360);
  }, [seedHash]);

  const noiseUrl = variant === "tile" ? NOISE_DATA_URL_FINE : NOISE_DATA_URL;

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
            background: `linear-gradient(${direction}deg, ${randomColor}, transparent), url("${noiseUrl}")`,
            filter: "contrast(220%) brightness(1000%)",
          }}
        />
        {children && (
          <div className="relative z-10 w-full h-full">{children}</div>
        )}
      </div>
    </section>
  );
}
