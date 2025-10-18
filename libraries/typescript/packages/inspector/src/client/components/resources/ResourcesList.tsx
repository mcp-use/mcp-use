import type { Resource } from '@modelcontextprotocol/sdk/types.js'
import {
  Database,
  File,
  FileCode,
  FileImage,
  FileText,
  Globe,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface ResourcesListProps {
  resources: Resource[]
  selectedResource: Resource | null
  onResourceSelect: (resource: Resource) => void
  focusedIndex: number
}

function getResourceIcon(mimeType?: string, uri?: string) {
  if (!mimeType && !uri)
    return <File className="h-5 w-5" />

  const type = (mimeType || uri || '').toLowerCase()

  if (type.includes('image')) {
    return <FileImage className="h-5 w-5" />
  }
  if (
    type.includes('json')
    || type.includes('javascript')
    || type.includes('typescript')
  ) {
    return <FileCode className="h-5 w-5" />
  }
  if (type.includes('html') || type.includes('xml')) {
    return <Globe className="h-5 w-5" />
  }
  if (type.includes('database') || type.includes('sql')) {
    return <Database className="h-5 w-5" />
  }

  return <FileText className="h-5 w-5" />
}

function getResourceTypeColor(mimeType?: string, uri?: string) {
  if (!mimeType && !uri) {
    return {
      bgColor: 'bg-gray-100 dark:bg-gray-800',
      iconColor: 'text-gray-600 dark:text-gray-400',
    }
  }

  const type = (mimeType || uri || '').toLowerCase()

  if (type.includes('image')) {
    return {
      bgColor: 'bg-purple-100 dark:bg-purple-900/30',
      iconColor: 'text-purple-600 dark:text-purple-400',
    }
  }
  if (
    type.includes('json')
    || type.includes('javascript')
    || type.includes('typescript')
  ) {
    return {
      bgColor: 'bg-blue-100 dark:bg-blue-900/30',
      iconColor: 'text-blue-600 dark:text-blue-400',
    }
  }
  if (type.includes('html') || type.includes('xml')) {
    return {
      bgColor: 'bg-green-100 dark:bg-green-900/30',
      iconColor: 'text-green-600 dark:text-green-400',
    }
  }
  if (type.includes('database') || type.includes('sql')) {
    return {
      bgColor: 'bg-orange-100 dark:bg-orange-900/30',
      iconColor: 'text-orange-600 dark:text-orange-400',
    }
  }

  return {
    bgColor: 'bg-gray-100 dark:bg-gray-800',
    iconColor: 'text-gray-600 dark:text-gray-400',
  }
}

export function ResourcesList({
  resources,
  selectedResource,
  onResourceSelect,
  focusedIndex,
}: ResourcesListProps) {
  if (resources.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
        <p>No resources available</p>
        <p className="text-sm">Connect to a server to see resources</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto overflow-x-visible mt-6 space-y-5 p-0">
      {resources.map((resource, index) => {
        const typeInfo = getResourceTypeColor(resource.mimeType, resource.uri)
        return (
          <div
            key={resource.uri}
            id={`resource-${resource.uri}`}
            className={cn(
              'cursor-pointer transition-all rounded-[20px] bg-zinc-100 dark:bg-white/10 hover:bg-zinc-200 dark:hover:bg-white/15 p-2',
              selectedResource?.uri === resource.uri
              && 'border-2 border-zinc-200 dark:border-zinc-600',
              focusedIndex === index
              && 'border-2 border-blue-500 dark:border-blue-400',
            )}
            onClick={() => onResourceSelect(resource)}
          >
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  'rounded-full p-3 flex items-center justify-center',
                  typeInfo.bgColor,
                )}
              >
                <div className={typeInfo.iconColor}>
                  {getResourceIcon(resource.mimeType, resource.uri)}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {resource.name}
                </div>
                {resource.description && (
                  <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                    {resource.description}
                  </div>
                )}
                {resource.mimeType && (
                  <div className="text-xs text-gray-500 dark:text-gray-500 mt-1 font-mono">
                    {resource.mimeType}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
