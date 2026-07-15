import { cn } from "@/client/lib/utils";
import { motion } from "motion/react";
import { useState } from "react";

/**
 * Render an SVG logo that runs a timed, hover-activated animation sequence and optionally shows a contextual label when expanded.
 *
 * The logo animates in a strict sequence on hover: the fill fades out, the outline draws, then the fill fades back in. The whole logo is wrapped in an anchor that opens `href` in a new tab.
 *
 * @param className - Optional additional CSS classes applied to the outer anchor.
 * @param state - Layout and presentation mode; `"expanded"` shows a larger logo and the right-side label, `"collapsed"` shows a compact logo without the label.
 * @param href - Destination URL for the anchor; opened in a new tab.
 * @returns The rendered anchor element containing the animated SVG logo and optional label.
 */
export default function LogoAnimated({
  className,
  state = "collapsed",
  href = "https://mcp-use.com",
}: {
  className?: string;
  state?: "expanded" | "collapsed";
  href?: string;
}) {
  const [isHovered, setIsHovered] = useState(false);

  // Tune these three to taste
  const FADE_OUT = 0.2; // seconds
  const DRAW = 0.7; // seconds
  const FADE_IN = 0.6; // seconds
  const STROKE_WIDTH = 4;
  const TOTAL = FADE_OUT + DRAW + FADE_IN;

  // Precomputed keyframe "times" for a single synced timeline (0..1)
  const T0 = 0; // start
  const T1 = FADE_OUT / TOTAL; // after fade out
  const T2 = (FADE_OUT + DRAW) / TOTAL; // after outline draw
  const T3 = 1; // end after fade in

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "flex items-center transition-opacity -my-3",
        state === "expanded" ? "space-x-2" : "",
        className
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="relative">
        <motion.svg
          viewBox="0 0 500 500"
          initial="rest"
          animate={isHovered ? "hover" : "rest"}
          className={cn(
            "text-foreground",
            state === "expanded" ? "size-[40px]" : "size-[20px]"
          )}
        >
          {/* FILLED SHAPES (1: fade out, 3: fade back in) */}
          <motion.g
            variants={{
              rest: { opacity: 1 },
              hover: {
                // 1 → 0 (fade out), hold at 0 while outline draws, then 0 → 1 (fade in)
                opacity: [1, 0, 0, 1],
                transition: {
                  duration: TOTAL,
                  times: [T0, T1, T2, T3],
                  ease: "easeInOut",
                },
              },
            }}
            fill="currentColor"
            fillRule="nonzero"
            stroke="currentColor"
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M105.933 0C164.437 0.000116002 211.865 47.607 211.865 106.333C211.865 131.829 210.493 158.403 221.068 181.602L228.975 198.947C243.584 230.997 269.265 256.7 301.303 271.336L316.155 278.121C340.142 289.079 367.694 287.335 394.066 287.335C452.571 287.335 499.999 334.942 499.999 393.668C499.999 452.394 452.571 500.001 394.066 500.001C335.562 500.001 288.134 452.394 288.134 393.668C288.134 368.974 289.24 343.275 278.992 320.807L270.586 302.38C255.948 270.29 230.214 244.565 198.118 229.939L180.164 221.758C157.282 211.331 131.078 212.666 105.933 212.666C47.4278 212.666 4.86252e-05 165.059 0 106.333C0 47.607 47.4278 0 105.933 0Z" />
            <circle cx="100.426" cy="399.575" r="100.426" />
            <path d="M500 100.426C500 155.889 455.037 200.851 399.574 200.851C344.11 200.851 299.148 155.889 299.148 100.426C299.148 44.962 344.11 0 399.574 0C455.037 0 500 44.962 500 100.426Z" />
          </motion.g>

          {/* STROKE OUTLINE (2: draws only after fade-out completes) */}
          <g
            fill="none"
            stroke="currentColor"
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <AnimatedStrokePath
              d="M105.933 0C164.437 0.000116002 211.865 47.607 211.865 106.333C211.865 131.829 210.493 158.403 221.068 181.602L228.975 198.947C243.584 230.997 269.265 256.7 301.303 271.336L316.155 278.121C340.142 289.079 367.694 287.335 394.066 287.335C452.571 287.335 499.999 334.942 499.999 393.668C499.999 452.394 452.571 500.001 394.066 500.001C335.562 500.001 288.134 452.394 288.134 393.668C288.134 368.974 289.24 343.275 278.992 320.807L270.586 302.38C255.948 270.29 230.214 244.565 198.118 229.939L180.164 221.758C157.282 211.331 131.078 212.666 105.933 212.666C47.4278 212.666 4.86252e-05 165.059 0 106.333C0 47.607 47.4278 0 105.933 0Z"
              times={ { T0, T1, T2, T3 } }
              total={TOTAL}
            />
            <AnimatedStrokeCircle
              cx={100.426}
              cy={399.575}
              r={100.426}
              times={ { T0, T1, T2, T3 } }
              total={TOTAL}
            />
            <AnimatedStrokePath
              d="M500 100.426C500 155.889 455.037 200.851 399.574 200.851C344.11 200.851 299.148 155.889 299.148 100.426C299.148 44.962 344.11 0 399.574 0C455.037 0 500 44.962 500 100.426Z"
              times={ { T0, T1, T2, T3 } }
              total={TOTAL}
            />
          </g>
        </motion.svg>
      </div>
      {state === "expanded" && (
        <div className="font-ubuntu flex-col items-start -space-y-1 mr-3 hidden xl:flex">
          <h1 className="text-xl font-medium">mcp-use</h1>
          <span className="text-lg text-muted-foreground tracking-wide font-sans font-light">
            Inspector
          </span>
        </div>
      )}
    </a>
  );
}

/** Draw-animated path using a shared timeline. */
function AnimatedStrokePath({
  d,
  times,
  total,
}: {
  d: string;
  times: { T0: number; T1: number; T2: number; T3: number };
  total: number;
}) {
  const { T0, T1, T2, T3 } = times;
  return (
    <motion.path
      d={d}
      variants={{
        rest: { pathLength: 0, opacity: 0 },
        hover: {
          // Hold hidden through fade-out, draw during [T1..T2], then hold visible
          pathLength: [0, 0, 1, 1],
          opacity: [0, 0, 1, 1],
          transition: {
            duration: total,
            times: [T0, T1, T2, T3],
            ease: "easeInOut",
          },
        },
      }}
    />
  );
}

/** Draw-animated circle using a shared timeline. */
function AnimatedStrokeCircle({
  cx,
  cy,
  r,
  times,
  total,
}: {
  cx: number;
  cy: number;
  r: number;
  times: { T0: number; T1: number; T2: number; T3: number };
  total: number;
}) {
  const { T0, T1, T2, T3 } = times;
  return (
    <motion.circle
      cx={cx}
      cy={cy}
      r={r}
      variants={{
        rest: { pathLength: 0, opacity: 0 },
        hover: {
          pathLength: [0, 0, 1, 1],
          opacity: [0, 0, 1, 1],
          transition: {
            duration: total,
            times: [T0, T1, T2, T3],
            ease: "easeInOut",
          },
        },
      }}
    />
  );
}
