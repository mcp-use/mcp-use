import type { ComponentPropsWithoutRef, CSSProperties } from 'react'
import React from 'react'

import { useTheme } from '@/client/context/ThemeContext'
import { cn } from '@/lib/utils'

export interface ShimmerButtonProps extends ComponentPropsWithoutRef<'button'> {
  shimmerColor?: string
  shimmerSize?: string
  borderRadius?: string
  shimmerDuration?: string
  background?: string
  className?: string
  children?: React.ReactNode
}

export const ShimmerButton = React.forwardRef<
  HTMLButtonElement,
  ShimmerButtonProps
>(
  (
    {
      shimmerColor,
      shimmerSize = '0.05em',
      shimmerDuration = '3s',
      borderRadius = '100px',
      background,
      className,
      children,
      ...props
    },
    ref,
  ) => {
    const { resolvedTheme } = useTheme()

    // Set default colors based on theme
    const defaultShimmerColor = resolvedTheme === 'dark' ? '#000000' : '#ffffff'
    const defaultBackground = resolvedTheme === 'dark' ? 'rgba(255, 255, 255, 1)' : 'rgba(0, 0, 0, 1)'

    const finalShimmerColor = shimmerColor || defaultShimmerColor
    const finalBackground = background || defaultBackground
    return (
      <button
        style={
          {
            '--spread': '90deg',
            '--shimmer-color': finalShimmerColor,
            '--radius': borderRadius,
            '--speed': shimmerDuration,
            '--cut': shimmerSize,
            '--bg': finalBackground,
          } as CSSProperties
        }
        className={cn(
          'group relative z-0 flex cursor-pointer items-center justify-center overflow-hidden [border-radius:var(--radius)] border px-6 py-3 whitespace-nowrap [background:var(--bg)]',
          'transform-gpu transition-transform duration-300 ease-in-out active:translate-y-px',
          resolvedTheme === 'dark'
            ? 'border-black/10 text-black'
            : 'border-white/10 text-white',
          className,
        )}
        ref={ref}
        {...props}
      >
        {/* spark container */}
        <div
          className={cn(
            '-z-30 blur-[2px]',
            '[container-type:size] absolute inset-0 overflow-visible',
          )}
        >
          {/* spark */}
          <div className="animate-shimmer-slide absolute inset-0 [aspect-ratio:1] h-[100cqh] [border-radius:0] [mask:none]">
            {/* spark before */}
            <div className="animate-spin-around absolute -inset-full w-auto [translate:0_0] rotate-0 [background:conic-gradient(from_calc(270deg-(var(--spread)*0.5)),transparent_0,var(--shimmer-color)_var(--spread),transparent_var(--spread))]" />
          </div>
        </div>
        {children}

        {/* Highlight */}
        <div
          className={cn(
            'absolute inset-0 size-full',

            'rounded-2xl px-4 py-1.5 text-sm font-medium',

            // transition
            'transform-gpu transition-all duration-300 ease-in-out',

            // theme-aware shadows
            resolvedTheme === 'dark'
              ? 'shadow-[inset_0_-8px_10px_#0000001f] group-hover:shadow-[inset_0_-6px_10px_#0000003f] group-active:shadow-[inset_0_-10px_10px_#0000003f]'
              : 'shadow-[inset_0_-8px_10px_#ffffff1f] group-hover:shadow-[inset_0_-6px_10px_#ffffff3f] group-active:shadow-[inset_0_-10px_10px_#ffffff3f]',
          )}
        />

        {/* backdrop */}
        <div
          className={cn(
            'absolute [inset:var(--cut)] -z-20 [border-radius:var(--radius)] [background:var(--bg)]',
          )}
        />
      </button>
    )
  },
)

ShimmerButton.displayName = 'ShimmerButton'
