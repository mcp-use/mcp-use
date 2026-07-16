import { cn } from "@/client/lib/utils";
import { motion } from "motion/react";
import { useState } from "react";
import { Link } from "react-router";

export default function LogoAnimated({
  className,
  state = "collapsed",
  to = "/",
  showLabel = state === "expanded",
  /** Keep the symbol centered in `--sidebar-width-icon`; label uses `--sidebar-nav-text-pl-absolute`. */
  pinSymbolInIconColumn = false,
  /** Symbol size in px; defaults to 20 in header icon column, else 20/40 by state. */
  size,
}: {
  className?: string;
  state?: "expanded" | "collapsed";
  to?: string;
  showLabel?: boolean;
  pinSymbolInIconColumn?: boolean;
  size?: number;
}) {
  const [isHovered, setIsHovered] = useState(false);

  const FADE_OUT = 0.2;
  const DRAW = 0.7;
  const FADE_IN = 0.6;
  const STROKE_WIDTH = 4;
  const TOTAL = FADE_OUT + DRAW + FADE_IN;

  const T0 = 0;
  const T1 = FADE_OUT / TOTAL;
  const T2 = (FADE_OUT + DRAW) / TOTAL;
  const T3 = 1;

  const isExpanded = state === "expanded";
  const showLabelNow = isExpanded && showLabel;
  const symbolSize =
    size ?? (pinSymbolInIconColumn ? 20 : state === "expanded" ? 40 : 20);

  const symbolSvg = (
    <div className="relative">
      <motion.svg
        viewBox="0 0 500 500"
        initial="rest"
        animate={isHovered ? "hover" : "rest"}
        className="text-foreground"
        style={{ width: symbolSize, height: symbolSize }}
      >
        <motion.g
          variants={{
            rest: { opacity: 1 },
            hover: {
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

        <g
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <AnimatedStrokePath
            d="M105.933 0C164.437 0.000116002 211.865 47.607 211.865 106.333C211.865 131.829 210.493 158.403 221.068 181.602L228.975 198.947C243.584 230.997 269.265 256.7 301.303 271.336L316.155 278.121C340.142 289.079 367.694 287.335 394.066 287.335C452.571 287.335 499.999 334.942 499.999 393.668C499.999 452.394 452.571 500.001 394.066 500.001C335.562 500.001 288.134 452.394 288.134 393.668C288.134 368.974 289.24 343.275 278.992 320.807L270.586 302.38C255.948 270.29 230.214 244.565 198.118 229.939L180.164 221.758C157.282 211.331 131.078 212.666 105.933 212.666C47.4278 212.666 4.86252e-05 165.059 0 106.333C0 47.607 47.4278 0 105.933 0Z"
            times={{ T0, T1, T2, T3 }}
            total={TOTAL}
          />
          <AnimatedStrokeCircle
            cx={100.426}
            cy={399.575}
            r={100.426}
            times={{ T0, T1, T2, T3 }}
            total={TOTAL}
          />
          <AnimatedStrokePath
            d="M500 100.426C500 155.889 455.037 200.851 399.574 200.851C344.11 200.851 299.148 155.889 299.148 100.426C299.148 44.962 344.11 0 399.574 0C455.037 0 500 44.962 500 100.426Z"
            times={{ T0, T1, T2, T3 }}
            total={TOTAL}
          />
        </g>
      </motion.svg>
    </div>
  );

  const labelEl = showLabel ? (
    <span
      className={cn(
        "flex gap-2 whitespace-nowrap",
        pinSymbolInIconColumn ? "items-center" : "items-baseline",
        pinSymbolInIconColumn
          ? cn(
              "pl-(--sidebar-nav-text-pl-absolute)",
              showLabelNow
                ? "relative opacity-100 blur-0"
                : "pointer-events-none absolute left-0 top-1/2 w-0 -translate-y-1/2 overflow-hidden opacity-0 blur-[3px]"
            )
          : "ml-0 gap-2"
      )}
    >
      <span className="font-ubuntu text-xl font-medium leading-none text-foreground [text-box:trim-both_cap_alphabetic]">
        mcp-use
      </span>
      <span className="text-sm font-semibold uppercase tracking-wide leading-none text-muted-foreground [text-box:trim-both_cap_alphabetic]">
        inspector
      </span>
    </span>
  ) : null;

  const logoInner = pinSymbolInIconColumn ? (
    <div
      className={cn(
        "relative flex shrink-0 items-center",
        showLabelNow
          ? "min-w-(--sidebar-width-icon)"
          : "w-(--sidebar-width-icon)"
      )}
    >
      <div className="pointer-events-none absolute inset-y-0 left-0 flex w-(--sidebar-width-icon) items-center justify-center">
        <div className="pointer-events-auto">{symbolSvg}</div>
      </div>
      {labelEl}
    </div>
  ) : (
    <>
      {symbolSvg}
      {labelEl}
    </>
  );

  return (
    <Link
      to={to}
      className={cn(
        "flex items-center transition-opacity",
        !pinSymbolInIconColumn && "-my-3",
        className
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {logoInner}
    </Link>
  );
}

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
