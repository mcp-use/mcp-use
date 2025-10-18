import { UIResourceRenderer } from '@mcp-ui/client'
import { memo } from 'react'

interface MCPUIResourceProps {
  resource: {
    uri?: string
    mimeType: string
    text?: string
    blob?: string
  }
}

export const MCPUIResource = memo(({
  resource,
}: MCPUIResourceProps) => {
  const handleUIAction = async (result: any) => {
    console.log('MCP-UI Action:', result)

    if (result.type === 'tool') {
      console.log(
        `Tool action: ${result.payload.toolName}`,
        result.payload.params,
      )
    }
    else if (result.type === 'prompt') {
      console.log('Prompt action:', result.payload.prompt)
    }
    else if (result.type === 'link') {
      console.log('Link action:', result.payload.url)
      // Optionally open the link
      if (result.payload.url) {
        window.open(result.payload.url, '_blank')
      }
    }
    else if (result.type === 'intent') {
      console.log('Intent action:', result.payload.intent)
    }
    else if (result.type === 'notify') {
      console.log('Notification:', result.payload.message)
    }

    return { status: 'Action received' }
  }

  // Only render if this is a UI resource
  if (!resource.uri?.startsWith('ui://')) {
    return null
  }

  return (
    <div className="my-4 p-0 border h-[350px] rounded-2xl border-zinc-200 overflow-hidden bg-card">
      <UIResourceRenderer
        resource={resource}
        onUIAction={handleUIAction}
        htmlProps={{
          style: {
            maxWidth: '100%',
            height: '100%',
            overflow: 'auto',
          },
          autoResizeIframe: true,
        }}
      />
    </div>
  )
})
