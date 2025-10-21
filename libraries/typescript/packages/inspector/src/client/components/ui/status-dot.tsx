import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/client/components/ui/tooltip'

interface StatusDotProps {
  status: string
}

export function StatusDot({ status }: StatusDotProps) {
  const getStatusInfo = (statusValue: string) => {
    switch (statusValue) {
      case 'ready':
        return {
          color: 'bg-emerald-500',
          ringColor: 'ring-emerald-500',
          tooltip: 'Connected',
        }
      case 'failed':
        return {
          color: 'bg-red-500',
          ringColor: 'ring-red-500',
          tooltip: 'Failed',
        }
      default:
        return {
          color: 'bg-yellow-500',
          ringColor: 'ring-yellow-500',
          tooltip: statusValue,
        }
    }
  }

  const { color, ringColor, tooltip } = getStatusInfo(status)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="relative">
          {/* Pulsing ring */}
          <div
            className={`absolute w-2 h-2 rounded-full ${ringColor} animate-ping`}
          />
          {/* Solid dot */}
          <div className={`relative w-2 h-2 rounded-full ${color}`} />
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <p>{tooltip}</p>
      </TooltipContent>
    </Tooltip>
  )
}
