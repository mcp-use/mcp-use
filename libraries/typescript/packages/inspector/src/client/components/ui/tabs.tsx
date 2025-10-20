'use client'

import type { LucideIcon } from 'lucide-react'
import * as React from 'react'
import { cn } from '@/client/lib/utils'

interface TabsContextType {
  activeValue: string
  handleValueChange: (value: string) => void
}

const TabsContext = React.createContext<TabsContextType | undefined>(undefined)

function useTabs() {
  const context = React.use(TabsContext)
  if (!context) {
    throw new Error('useTabs must be used within a TabsProvider')
  }
  return context
}

interface TabsListContextType {
  variant: 'default' | 'underline'
}

const TabsListContext = React.createContext<TabsListContextType | undefined>(
  undefined,
)

function useTabsList() {
  const context = React.use(TabsListContext)
  return context
}

interface TabsProps {
  children: React.ReactNode
  defaultValue?: string
  value?: string
  onValueChange?: (value: string) => void
  className?: string
}

function Tabs({
  ref,
  children,
  defaultValue,
  value,
  onValueChange,
  className,
  ...props
}: TabsProps & { ref?: React.RefObject<HTMLDivElement | null> }) {
  const [activeValue, setActiveValue] = React.useState(defaultValue || '')
  const isControlled = value !== undefined

  const handleValueChange = React.useCallback(
    (val: string) => {
      if (!isControlled) {
        setActiveValue(val)
      }
      onValueChange?.(val)
    },
    [isControlled, onValueChange],
  )

  const currentValue = isControlled ? value : activeValue

  return (
    <TabsContext
      value={{
        activeValue: currentValue,
        handleValueChange,
      }}
    >
      <div
        ref={ref}
        className={cn('flex flex-col gap-2', className)}
        {...props}
      >
        {children}
      </div>
    </TabsContext>
  )
}
Tabs.displayName = 'Tabs'

interface TabsListProps {
  children: React.ReactNode
  className?: string
  variant?: 'default' | 'underline'
}

function TabsList({
  ref: _ref,
  children,
  className,
  variant = 'default',
  ...props
}: TabsListProps & { ref?: React.RefObject<HTMLDivElement | null> }) {
  const { activeValue } = useTabs()
  const [indicatorStyle, setIndicatorStyle] = React.useState({
    width: 0,
    left: 0,
  })
  const containerRef = React.useRef<HTMLDivElement>(null)
  const resizeObserverRef = React.useRef<ResizeObserver | null>(null)
  const debounceTimeoutRef = React.useRef<NodeJS.Timeout | null>(null)
  const childrenArray = React.Children.toArray(children)
  const activeIndex = childrenArray.findIndex(
    child =>
      React.isValidElement(child)
      && (child.props as { value: string }).value === activeValue,
  )

  // Debounced update function
  const updateIndicator = React.useCallback(() => {
    const container = containerRef.current
    if (!container)
      return

    const triggers = container.querySelectorAll('button')
    const activeTrigger = triggers[activeIndex] as HTMLElement

    if (activeTrigger) {
      const containerRect = container.getBoundingClientRect()
      const triggerRect = activeTrigger.getBoundingClientRect()

      setIndicatorStyle({
        width: triggerRect.width,
        left: triggerRect.left - containerRect.left,
      })
    }
  }, [activeIndex])

  // Debounced version of updateIndicator
  const debouncedUpdateIndicator = React.useCallback(() => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current)
    }
    debounceTimeoutRef.current = setTimeout(updateIndicator, 16) // ~60fps
  }, [updateIndicator])

  // Update indicator when active tab changes
  React.useEffect(() => {
    // Use a small delay to ensure DOM is updated
    const timeoutId = setTimeout(updateIndicator, 10)
    return () => clearTimeout(timeoutId)
  }, [updateIndicator])

  // Set up ResizeObserver for the container
  React.useEffect(() => {
    const container = containerRef.current
    if (!container)
      return

    // Create ResizeObserver to watch for container size changes
    resizeObserverRef.current = new ResizeObserver(() => {
      debouncedUpdateIndicator()
    })

    resizeObserverRef.current.observe(container)

    // Also observe all button elements for size changes
    const triggers = container.querySelectorAll('button')
    triggers.forEach((trigger) => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.observe(trigger)
      }
    })

    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect()
      }
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current)
      }
    }
  }, [debouncedUpdateIndicator])

  // Fallback window resize listener for broader compatibility
  React.useEffect(() => {
    const handleResize = () => {
      debouncedUpdateIndicator()
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [debouncedUpdateIndicator])

  // Apply dynamic styles using data attributes
  React.useEffect(() => {
    const container = containerRef.current
    if (!container)
      return

    const glider = container.querySelector('[data-width]') as HTMLElement
    if (glider) {
      glider.style.width = `${indicatorStyle.width}px`
      glider.style.left = `${indicatorStyle.left}px`
    }
  }, [indicatorStyle])

  return (
    <TabsListContext value={{ variant }}>
      <div
        ref={containerRef}
        className={cn(
          'relative flex bg-none',
          variant === 'default'
          && 'p-1 rounded-full border border-zinc-300 dark:border-zinc-600',
          variant === 'underline'
          && 'border-b border-zinc-200 dark:border-zinc-700',
          className,
        )}
        {...props}
      >
        {children}
        <span
          className={cn(
            'absolute transition-all duration-200 ease-out z-0',
            variant === 'default'
            && 'bg-white dark:bg-zinc-700 rounded-full h-[calc(100%-8px)] top-1 border border-zinc-300 dark:border-zinc-600',
            variant === 'underline' && 'bottom-0 h-0.5 bg-black dark:bg-white',
          )}
          data-width={indicatorStyle.width}
          data-left={indicatorStyle.left}
        />
      </div>
    </TabsListContext>
  )
}
TabsList.displayName = 'TabsList'

interface TabsTriggerProps {
  children: React.ReactNode
  value: string
  className?: string
  disabled?: boolean
  icon?: LucideIcon
}

/**
 * TabsTrigger component with optional Lucide icon support.
 *
 * @example
 * ```tsx
 * import { Settings, User } from 'lucide-react'
 *
 * <TabsTrigger value="settings" icon={Settings}>
 *   Settings
 * </TabsTrigger>
 * ```
 */
function TabsTrigger({
  ref,
  children,
  value,
  className,
  disabled,
  icon: Icon,
  ...props
}: TabsTriggerProps & { ref?: React.RefObject<HTMLButtonElement | null> }) {
  const { activeValue, handleValueChange } = useTabs()
  const tabsListContext = useTabsList()
  const variant = tabsListContext?.variant || 'default'
  const isActive = activeValue === value

  return (
    <button
      ref={ref}
      disabled={disabled}
      onClick={() => handleValueChange(value)}
      className={cn(
        'relative z-10 flex-1 inline-flex items-center justify-center whitespace-nowrap text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-pointer',
        variant === 'default' && 'rounded-md px-4 py-2.5',
        variant === 'underline' && 'px-6 py-3 border-b-2 border-transparent',
        isActive && 'text-foreground',
        !isActive && 'text-muted-foreground hover:text-foreground',
        className,
      )}
      {...props}
    >
      {Icon && <Icon className="mr-2 h-4 w-4" />}
      {children}
    </button>
  )
}
TabsTrigger.displayName = 'TabsTrigger'

interface TabsContentProps {
  children: React.ReactNode
  value: string
  className?: string
}

function TabsContent({
  ref,
  children,
  value,
  className,
  ...props
}: TabsContentProps & { ref?: React.RefObject<HTMLDivElement | null> }) {
  const { activeValue } = useTabs()
  const isActive = activeValue === value

  if (!isActive)
    return null

  return (
    <div
      ref={ref}
      role="tabpanel"
      className={cn(
        'mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}
TabsContent.displayName = 'TabsContent'

export { Tabs, TabsContent, TabsList, TabsTrigger, useTabs }
