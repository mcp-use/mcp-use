import { motion } from "framer-motion";
import { useState } from "react";
import { cn } from "@/client/lib/utils";

/**
 * HoverDrawLogo (timed sequence)
 *
 * Strict order on hover:
 * 1) Fill fades out completely
 * 2) THEN the outline draws
 * 3) THEN the fill fades back in
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
          viewBox="0 0 303 303"
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
            <path d="m105.5 34.8.6.6c9.5 9.5 14.4 21.9 14.6 34.4a112.6 112.6 0 0 0 112.2 112.1h.6c12 .4 24 5.1 33.2 14.1l.6.6a50 50 0 0 1-70.1 71.3l-.6-.6A49.9 49.9 0 0 1 182 230 112.6 112.6 0 0 0 73.4 120.7h-.8a49.9 49.9 0 0 1-36.7-14l-.5-.6a50 50 0 0 1-.6-70.2l.6-.5a50 50 0 0 1 69.5-1.2l.6.6Z" />
            <circle cx="70.3" cy="232.3" r="50" />
            <circle cx="232.3" cy="70.3" r="50" />
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
              d="m105.5 34.8.6.6c9.5 9.5 14.4 21.9 14.6 34.4a112.6 112.6 0 0 0 112.2 112.1h.6c12 .4 24 5.1 33.2 14.1l.6.6a50 50 0 0 1-70.1 71.3l-.6-.6A49.9 49.9 0 0 1 182 230 112.6 112.6 0 0 0 73.4 120.7h-.8a49.9 49.9 0 0 1-36.7-14l-.5-.6a50 50 0 0 1-.6-70.2l.6-.5a50 50 0 0 1 69.5-1.2l.6.6Z"
              times={{ T0, T1, T2, T3 }}
              total={TOTAL}
            />
            <AnimatedStrokeCircle
              cx={70.3}
              cy={232.3}
              r={50}
              times={{ T0, T1, T2, T3 }}
              total={TOTAL}
            />
            <AnimatedStrokeCircle
              cx={232.3}
              cy={70.3}
              r={50}
              times={{ T0, T1, T2, T3 }}
              total={TOTAL}
            />
          </g>
        </motion.svg>
      </div>
      {state === "expanded" && (
        <div className="font-ubuntu flex flex-col items-start -space-y-1 mr-3">
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
