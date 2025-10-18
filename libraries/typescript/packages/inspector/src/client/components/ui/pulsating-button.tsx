import React from 'react'

import { cn } from '@/lib/utils'

interface PulsatingButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  pulseColor?: string
  duration?: string
}

export function PulsatingButton({ ref, className, children, pulseColor = '#808080', duration = '1.5s', ...props }: PulsatingButtonProps & { ref?: React.RefObject<HTMLButtonElement | null> }) {
  return (
    <button
      ref={ref}
      className={cn(
        'bg-primary text-primary-foreground relative flex cursor-pointer items-center justify-center rounded-lg px-4 py-2 text-center',
        className,
      )}
      style={
        {
          '--pulse-color': pulseColor,
          '--duration': duration,
        } as React.CSSProperties
      }
      {...props}
    >
      <div className="relative z-10 flex items-center justify-center gap-2">{children}</div>
      <div className="absolute top-1/2 left-1/2 size-full -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full bg-inherit" />
    </button>
  )
}

PulsatingButton.displayName = 'PulsatingButton'
