"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  type TransitionEvent,
} from "react";
import { cn } from "@/client/lib/utils";
import { useTheme } from "@/client/context/ThemeContext";
import { MeshGradientCanvas } from "@/client/components/ui/MeshGradientCanvas";
import { meshColorsForTheme } from "@/client/components/ui/mesh-gradient-colors";
import {
  CHAT_MESH_ANIMATION_PAUSED_KEY,
  MeshAnimationPauseButton,
  useMeshAnimationPaused,
} from "@/client/components/ui/mesh-animation-pause";

/** Share of tab height used for the bottom mesh glow. */
const BOTTOM_MESH_RATIO = 0.54;
/** Chat landing mesh motion — slower than connect panel / defaults. */
const CHAT_MESH_SPEED = 0.4;
/** Alpha mask — fades mesh out toward the top (not a colored overlay). */
const MESH_FADE_MASK =
  "linear-gradient(to top, black 0%, black 12%, rgba(0,0,0,0.55) 38%, transparent 100%)";

export type ShaderPhase = "visible" | "fading" | "hidden";

interface MeshTabBackgroundProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  shaderPhase?: ShaderPhase;
  onShaderFadeComplete?: () => void;
  /** Also pause shader motion (e.g. while a modal is open over the chat tab). */
  meshAnimationPaused?: boolean;
}

export function MeshTabBackground({
  className,
  children,
  shaderPhase = "hidden",
  onShaderFadeComplete,
  meshAnimationPaused = false,
  ...props
}: MeshTabBackgroundProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [shaderReady, setShaderReady] = useState(false);
  const { resolvedTheme } = useTheme();
  const meshColors = meshColorsForTheme(resolvedTheme);
  const isDark = resolvedTheme === "dark";
  const { paused: userMeshPaused, toggle: toggleMeshAnimationPaused } =
    useMeshAnimationPaused(CHAT_MESH_ANIMATION_PAUSED_KEY);
  const meshPaused = userMeshPaused || meshAnimationPaused;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setShaderReady(true));
    return () => window.cancelAnimationFrame(frame);
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
        "relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background",
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
          <div
            className={cn(
              "absolute inset-0",
              shaderReady ? (isDark ? "opacity-90" : "opacity-75") : "opacity-0"
            )}
            style={
              {
                maskImage: MESH_FADE_MASK,
                WebkitMaskImage: MESH_FADE_MASK,
              } as CSSProperties
            }
          >
            <div className="absolute inset-0 bg-[#edf2ff] dark:hidden" />
            <MeshGradientCanvas
              className="absolute inset-0 h-full w-full"
              colors={[...meshColors]}
              distortion={0.8}
              swirl={0.1}
              grainMixer={0}
              grainOverlay={isDark ? 0.12 : 0.3}
              speed={meshPaused ? 0 : CHAT_MESH_SPEED}
            />
          </div>
        </div>
      )}
      {showShaderLayer && (
        <MeshAnimationPauseButton
          paused={userMeshPaused}
          onToggle={toggleMeshAnimationPaused}
          className="absolute bottom-3 right-3 sm:bottom-5 sm:right-5"
        />
      )}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        {children}
      </div>
    </div>
  );
}
