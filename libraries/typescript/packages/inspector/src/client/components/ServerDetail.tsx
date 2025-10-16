import { CheckCircle2, Code, Copy, Database, Loader2, Play, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { useMcpContext } from '../context/McpContext'

export function ServerDetail() {
  const { serverId } = useParams()
  const { getConnection, connectServer } = useMcpContext()
  const decodedServerId = serverId ? decodeURIComponent(serverId) : ''
  const connection = getConnection(decodedServerId)

  const [selectedTool, setSelectedTool] = useState<string | null>(null)
  const [toolInput, setToolInput] = useState('{}')
  const [toolResult, setToolResult] = useState<any>(null)
  const [isExecuting, setIsExecuting] = useState(false)

  // Auto-connect the server when viewing its details page
  // This ensures the server connects even if auto-connect is disabled globally
  useEffect(() => {
    if (decodedServerId && connection?.state === 'disconnected') {
      console.warn('[ServerDetail] Auto-connecting server for details page:', decodedServerId)
      connectServer(decodedServerId)
    }
  }, [decodedServerId, connection?.state, connectServer])

  const handleExecuteTool = async (toolName: string) => {
    if (!connection)
      return

    setIsExecuting(true)
    try {
      const inputArgs = JSON.parse(toolInput)
      const result = await connection.callTool(toolName, inputArgs)
      setToolResult({
        tool: toolName,
        input: inputArgs,
        result,
        timestamp: new Date().toISOString(),
      })
    }
    catch (error) {
      setToolResult({
        tool: toolName,
        input: toolInput,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      })
    }
    finally {
      setIsExecuting(false)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  if (!connection) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground">Loading server...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">{connection.name}</h2>
        <p className="text-muted-foreground font-mono text-sm">
          {connection.url}
        </p>
        <div className="flex items-center space-x-2 mt-2">
          {connection.state === 'ready' && (
            <span className="flex items-center text-sm text-green-600">
              <CheckCircle2 className="w-4 h-4 mr-1" />
              Connected
            </span>
          )}
          {(connection.state === 'connecting' || connection.state === 'loading') && (
            <span className="flex items-center text-sm text-yellow-600">
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              {connection.state}
            </span>
          )}
        </div>
      </div>

      {connection.state === 'ready' && (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Zap className="w-5 h-5" />
                  <span>
                    Tools (
                    {connection.tools.length}
                    )
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {connection.tools.length === 0
                  ? (
                      <p className="text-sm text-muted-foreground">No tools available</p>
                    )
                  : (
                      connection.tools.map(tool => (
                        <div key={tool.name} className="border rounded-lg p-4">
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="font-semibold">{tool.name}</h4>
                            <Button
                              size="sm"
                              onClick={() => {
                                setSelectedTool(tool.name)
                                setToolInput('{}')
                                setToolResult(null)
                              }}
                            >
                              <Play className="w-4 h-4 mr-1" />
                              Execute
                            </Button>
                          </div>
                          {tool.description && (
                            <p className="text-sm text-muted-foreground mb-2">
                              {tool.description}
                            </p>
                          )}
                          {tool.inputSchema && (
                            <details className="text-xs">
                              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                                <Code className="w-3 h-3 inline mr-1" />
                                View Schema
                              </summary>
                              <pre className="mt-2 p-2 bg-muted rounded overflow-auto">
                                {JSON.stringify(tool.inputSchema, null, 2)}
                              </pre>
                            </details>
                          )}
                        </div>
                      ))
                    )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Database className="w-5 h-5" />
                  <span>
                    Resources (
                    {connection.resources.length}
                    )
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {connection.resources.length === 0
                  ? (
                      <p className="text-sm text-muted-foreground">No resources available</p>
                    )
                  : (
                      connection.resources.map(resource => (
                        <div key={resource.uri} className="border rounded-lg p-4">
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="font-semibold">{resource.name || resource.uri}</h4>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => copyToClipboard(resource.uri)}
                            >
                              <Copy className="w-4 h-4" />
                            </Button>
                          </div>
                          {resource.description && (
                            <p className="text-sm text-muted-foreground mb-2">
                              {resource.description}
                            </p>
                          )}
                          <div className="text-xs text-muted-foreground">
                            <span className="font-mono break-all">{resource.uri}</span>
                            {resource.mimeType && (
                              <span className="ml-2">
                                (
                                {resource.mimeType}
                                )
                              </span>
                            )}
                          </div>
                        </div>
                      ))
                    )}
              </CardContent>
            </Card>
          </div>

          {selectedTool && (
            <Card>
              <CardHeader>
                <CardTitle>
                  Execute Tool:
                  {' '}
                  {selectedTool}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">Input (JSON):</label>
                  <Textarea
                    placeholder='{"key": "value"}'
                    value={toolInput}
                    onChange={e => setToolInput(e.target.value)}
                    className="font-mono text-sm"
                    rows={6}
                  />
                </div>
                <div className="flex space-x-2">
                  <Button
                    onClick={() => handleExecuteTool(selectedTool)}
                    disabled={isExecuting}
                  >
                    {isExecuting
                      ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Executing...
                          </>
                        )
                      : (
                          'Execute'
                        )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSelectedTool(null)
                      setToolResult(null)
                    }}
                  >
                    Cancel
                  </Button>
                </div>
                {toolResult && (
                  <div className={`border rounded-lg p-4 ${toolResult.error ? 'bg-red-50' : 'bg-muted'}`}>
                    <h4 className="font-semibold mb-2">Result:</h4>
                    <pre className="text-sm overflow-auto max-h-96">
                      {JSON.stringify(toolResult, null, 2)}
                    </pre>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {connection.state === 'pending_auth' && (
        <Card>
          <CardContent className="p-6">
            <h3 className="text-lg font-semibold mb-2">Authentication Required</h3>
            <p className="text-muted-foreground mb-4">
              This server requires authentication. Click the button below to authenticate.
            </p>
            <Button onClick={connection.authenticate}>
              Authenticate
            </Button>
            {connection.authUrl && (
              <div className="mt-4">
                <a
                  href={connection.authUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 underline"
                >
                  Or open authentication page manually
                </a>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {connection.state === 'failed' && connection.error && (
        <Card>
          <CardContent className="p-6">
            <h3 className="text-lg font-semibold text-red-600 mb-2">Connection Failed</h3>
            <p className="text-muted-foreground mb-4">{connection.error}</p>
            <Button onClick={connection.retry}>
              Retry Connection
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
