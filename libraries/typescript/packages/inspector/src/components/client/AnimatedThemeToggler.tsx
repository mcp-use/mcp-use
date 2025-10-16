'use client'

import { cn } from '@/lib/utils'
import { Monitor, Moon, SunDim } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useTheme } from '../../client/context/ThemeContext'

interface props {
  className?: string
}

export function AnimatedThemeToggler({ className }: props) {
  const { theme, setTheme } = useTheme()
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const [mounted, setMounted] = useState(false)

  // Prevent hydration mismatch by only showing theme-dependent content after mount
  useEffect(() => {
    setMounted(true)
  }, [])

  // Cycle through: system -> light -> dark -> system
  const getNextTheme = () => {
    if (theme === 'system') return 'light'
    if (theme === 'light') return 'dark'
    return 'system'
  }

  const getThemeIcon = () => {
    if (theme === 'system') return <Monitor className="size-4" />
    if (theme === 'light') return <SunDim className="size-4" />
    return <Moon className="size-4" />
  }

  const getThemeLabel = () => {
    if (theme === 'system') return 'Switch to light mode'
    if (theme === 'light') return 'Switch to dark mode'
    return 'Switch to system mode'
  }

  const changeTheme = async () => {
    if (!buttonRef.current) return

    const nextTheme = getNextTheme()

    // Check if view transitions are supported
    if (typeof document !== 'undefined' && 'startViewTransition' in document) {
      await document.startViewTransition(() => {
        flushSync(() => {
          setTheme(nextTheme)
        })
      }).ready

      const { top, left, width, height } =
        buttonRef.current.getBoundingClientRect()
      const y = top + height / 2
      const x = left + width / 2

      const right = window.innerWidth - left
      const bottom = window.innerHeight - top
      const maxRad = Math.hypot(Math.max(left, right), Math.max(top, bottom))

      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${maxRad}px at ${x}px ${y}px)`,
          ],
        },
        {
          duration: 700,
          easing: 'ease-in-out',
          pseudoElement: '::view-transition-new(root)',
        }
      )
    } else {
      // Fallback for browsers that don't support view transitions
      setTheme(nextTheme)
    }
  }

  // Show a placeholder during SSR to prevent hydration mismatch
  if (!mounted) {
    return (
      <button
        ref={buttonRef}
        className={cn(className)}
        aria-label="Toggle theme"
      >
        <Monitor className="size-4" />
      </button>
    )
  }

  return (
    <button
      ref={buttonRef}
      onClick={changeTheme}
      className={cn(className)}
      aria-label={getThemeLabel()}
      title={`Current: ${
        theme === 'system' ? 'Auto' : theme === 'light' ? 'Light' : 'Dark'
      }`}
    >
      {getThemeIcon()}
    </button>
  )
}
