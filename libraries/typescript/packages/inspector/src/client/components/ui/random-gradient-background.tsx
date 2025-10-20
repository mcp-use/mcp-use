'use client'

import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { cn } from '@/client/lib/utils'

export interface RandomGradientBackgroundProps {
  className?: string
  children?: ReactNode
  grayscaled?: boolean
  color?: string | null // oklch(hue lightness saturation)
}

export function RandomGradientBackground({
  className,
  color,
  children,
  grayscaled = false,
}: RandomGradientBackgroundProps) {
  const saturation = useMemo(() => {
    if (color) {
      const values = color.split('(')[1].split(')')[0].trim().split(/\s+/)
      return Number.parseFloat(values[1] || '0')
    }
    return grayscaled ? 0 : 0.2
  }, [color, grayscaled])

  const lightness = useMemo(() => {
    if (color) {
      const values = color.split('(')[1].split(')')[0].trim().split(/\s+/)
      return Number.parseFloat(values[0] || '0.5')
    }
    return grayscaled ? 0.3 : 0.4
  }, [color, grayscaled])

  const randomHue = useMemo(() => {
    if (color) {
      const values = color.split('(')[1].split(')')[0].trim().split(/\s+/)
      return Number.parseFloat(values[2] || '0')
    }
    return Math.floor(Math.random() * 360)
  }, [color])

  const randomColor = useMemo(() => {
    if (color) {
      return color
    }
    return `oklch(${Math.min(lightness, 1)} ${saturation} ${randomHue})`
  }, [randomHue, saturation, lightness])

  const lightColor = useMemo(() => {
    return `oklch(${Math.min(lightness * 2, 1)} ${saturation} ${randomHue})`
  }, [randomHue, saturation, lightness, color])

  const direction = useMemo(() => {
    return Math.floor(Math.random() * 360)
  }, [randomHue])

  const brightnessFilter = useMemo(() => {
    return '1000%'
  }, [])

  return (
    <section
      className={cn('relative w-full h-full overflow-hidden', className)}
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
  )
}
