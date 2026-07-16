"use client";

import { MeshGradient } from "@paper-design/shaders-react";
import {
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
  type TransitionEvent,
} from "react";
import { cn } from "@/client/lib/utils";

const MESH_COLORS = ["#e0eaff", "#f9ffbd", "#dedede", "#ffffff"] as const;
/** Share of tab height used for the bottom mesh glow. */
const BOTTOM_MESH_RATIO = 0.5;

export type ShaderPhase = "visible" | "fading" | "hidden";

interface MeshTabBackgroundProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  shaderPhase?: ShaderPhase;
  onShaderFadeComplete?: () => void;
}

export function MeshTabBackground({
  className,
  children,
  shaderPhase = "hidden",
  onShaderFadeComplete,
  ...props
}: MeshTabBackgroundProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 400 });
  const [shaderReady, setShaderReady] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setShaderReady(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        setSize({
          width: Math.ceil(width),
          height: Math.ceil(height * BOTTOM_MESH_RATIO),
        });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (shaderPhase === "fading" && !shaderReady) {
      onShaderFadeComplete?.();
    }
  }, [shaderPhase, shaderReady, onShaderFadeComplete]);

  const showShaderLayer = shaderPhase !== "hidden";
  const shaderVisible = shaderPhase === "visible" && shaderReady;

  const handleShaderTransitionEnd = (
    event: TransitionEvent<HTMLDivElement>
  ) => {
    if (event.propertyName !== "opacity") return;
    if (shaderPhase === "fading") {
      onShaderFadeComplete?.();
    }
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative flex min-h-0 flex-1 flex-col overflow-hidden bg-white dark:bg-black",
        className
      )}
      {...props}
    >
      {showShaderLayer && (
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-0 z-0 transition-opacity duration-500",
            shaderVisible ? "opacity-100" : "opacity-0"
          )}
          style={{ height: `${BOTTOM_MESH_RATIO * 100}%` }}
          aria-hidden
          onTransitionEnd={handleShaderTransitionEnd}
        >
          <div className="absolute inset-0 bg-[#edf2ff] dark:bg-[#1e293b]" />
          <div
            className={cn(
              "absolute inset-0",
              shaderReady ? "opacity-70 dark:opacity-40" : "opacity-0"
            )}
          >
            <MeshGradient
              width={size.width}
              height={size.height}
              colors={[...MESH_COLORS]}
              distortion={0.8}
              swirl={0.1}
              grainMixer={0}
              grainOverlay={0.3}
              speed={1}
            />
          </div>
          {/* Fade mesh into the tab background above */}
          <div className="absolute inset-0 bg-gradient-to-t from-white/0 via-white/70 to-white dark:from-black/0 dark:via-black/70 dark:to-black" />
        </div>
      )}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        {children}
      </div>
    </div>
  );
}
