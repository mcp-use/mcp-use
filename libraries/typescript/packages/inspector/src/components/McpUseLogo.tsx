import { cn } from '@/lib/utils'

interface McpUseLogoProps {
  className?: string
  size?: 'sm' | 'md' | 'lg'
}

export function McpUseLogo({ className, size = 'md' }: McpUseLogoProps) {
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-5 w-5',
    lg: 'h-6 w-6',
  }

  return (
    <svg
      viewBox="0 0 303 303"
      className={cn('text-current', sizeClasses[size], className)}
      fill="currentColor"
      fillRule="nonzero"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m105.5 34.8.6.6c9.5 9.5 14.4 21.9 14.6 34.4a112.6 112.6 0 0 0 112.2 112.1h.6c12 .4 24 5.1 33.2 14.1l.6.6a50 50 0 0 1-70.1 71.3l-.6-.6A49.9 49.9 0 0 1 182 230 112.6 112.6 0 0 0 73.4 120.7h-.8a49.9 49.9 0 0 1-36.7-14l-.5-.6a50 50 0 0 1-.6-70.2l.6-.5a50 50 0 0 1 69.5-1.2l.6.6Z" />
      <circle cx="70.3" cy="232.3" r="50" />
      <circle cx="232.3" cy="70.3" r="50" />
    </svg>
  )
}
