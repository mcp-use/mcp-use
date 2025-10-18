'use client'

import type { FormEvent, ReactNode } from 'react'
import { AlertCircle, CheckCircle, Loader2, Plus } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from './button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './dialog'
import { Input } from './input'
import { Label } from './label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select'
import { Textarea } from './textarea'

interface AddServerDialogProps {
  onServerAdded: (server: { id: string, name: string, url: string, type: string, color?: string }) => void
  children?: ReactNode
}

interface ServerFormData {
  name: string
  url: string
  type: 'http' | 'websocket'
  description?: string
}

export function AddServerDialog({ onServerAdded, children }: AddServerDialogProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  const [formData, setFormData] = useState<ServerFormData>({
    name: '',
    url: '',
    type: 'http',
    description: '',
  })

  const handleInputChange = (field: keyof ServerFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    // Reset status when user starts typing
    if (connectionStatus !== 'idle') {
      setConnectionStatus('idle')
      setErrorMessage('')
    }
  }

  const validateForm = (): string | null => {
    if (!formData.name.trim()) {
      return 'Server name is required'
    }
    if (!formData.url.trim()) {
      return 'Server URL is required'
    }

    // Basic URL validation
    try {
      URL.parse(formData.url)
    }
    catch {
      return 'Please enter a valid URL'
    }

    return null
  }

  const testConnection = async (): Promise<boolean> => {
    try {
      setIsConnecting(true)
      setConnectionStatus('idle')
      setErrorMessage('')

      // Import MCP client dynamically
      const { default: MCPClient } = await import('mcp-use/browser')

      // Create a temporary client to test the connection
      const testClient = MCPClient({
        mcpServers: {
          test: {
            [formData.type === 'websocket' ? 'ws_url' : 'url']: formData.url,
          },
        },
      })

      // Try to create a session (this will test the connection)
      await testClient.createSession('test', true)

      setConnectionStatus('success')
      return true
    }
    catch (error) {
      console.error('Connection test failed:', error)
      setConnectionStatus('error')
      setErrorMessage(error instanceof Error ? error.message : 'Connection failed')
      return false
    }
    finally {
      setIsConnecting(false)
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()

    const validationError = validateForm()
    if (validationError) {
      setErrorMessage(validationError)
      setConnectionStatus('error')
      return
    }

    // Test connection first
    const connectionSuccessful = await testConnection()
    if (!connectionSuccessful) {
      return
    }

    // Generate a unique ID and color
    const id = `server-${Date.now()}`
    const colors = [
      'oklch(0.6 0.2 120)',
      'oklch(0.5 0.3 200)',
      'oklch(0.7 0.2 60)',
      'oklch(0.6 0.25 300)',
      'oklch(0.5 0.2 180)',
      'oklch(0.7 0.3 0)',
    ]
    const color = colors[Math.floor(Math.random() * colors.length)]

    // Add the server
    onServerAdded({
      id,
      name: formData.name,
      url: formData.url,
      type: formData.type,
      color,
    })

    // Reset form and close dialog
    setFormData({
      name: '',
      url: '',
      type: 'http',
      description: '',
    })
    setConnectionStatus('idle')
    setErrorMessage('')
    setIsOpen(false)
  }

  const handleCancel = () => {
    setFormData({
      name: '',
      url: '',
      type: 'http',
      description: '',
    })
    setConnectionStatus('idle')
    setErrorMessage('')
    setIsOpen(false)
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {children || (
          <Button variant="outline" size="sm" className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Add Server
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add New Server</DialogTitle>
          <DialogDescription>
            Connect to a new MCP server by providing its URL and configuration.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Server Name */}
          <div className="space-y-2">
            <Label htmlFor="server-name">Server Name</Label>
            <Input
              id="server-name"
              placeholder="e.g., Linear, GitHub, etc."
              value={formData.name}
              onChange={e => handleInputChange('name', e.target.value)}
              className={cn(
                connectionStatus === 'error' && !formData.name.trim() && 'border-red-500',
              )}
            />
          </div>

          {/* Server Type */}
          <div className="space-y-2">
            <Label htmlFor="server-type">Connection Type</Label>
            <Select
              value={formData.type}
              onValueChange={(value: 'http' | 'websocket') => handleInputChange('type', value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="http">HTTP/SSE</SelectItem>
                <SelectItem value="websocket">WebSocket</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Server URL */}
          <div className="space-y-2">
            <Label htmlFor="server-url">Server URL</Label>
            <Input
              id="server-url"
              placeholder={formData.type === 'websocket' ? 'ws://localhost:3000' : 'http://localhost:3000'}
              value={formData.url}
              onChange={e => handleInputChange('url', e.target.value)}
              className={cn(
                connectionStatus === 'error' && !formData.url.trim() && 'border-red-500',
              )}
            />
            <p className="text-xs text-muted-foreground">
              {formData.type === 'websocket'
                ? 'WebSocket URL (e.g., ws://localhost:3000)'
                : 'HTTP URL (e.g., http://localhost:3000)'}
            </p>
          </div>

          {/* Description (Optional) */}
          <div className="space-y-2">
            <Label htmlFor="server-description">Description (Optional)</Label>
            <Textarea
              id="server-description"
              placeholder="Brief description of this server..."
              value={formData.description}
              onChange={e => handleInputChange('description', e.target.value)}
              rows={2}
            />
          </div>

          {/* Connection Status */}
          {connectionStatus !== 'idle' && (
            <div className={cn(
              'flex items-center gap-2 p-3 rounded-lg text-sm',
              connectionStatus === 'success' && 'bg-green-50 text-green-700 border border-green-200',
              connectionStatus === 'error' && 'bg-red-50 text-red-700 border border-red-200',
            )}
            >
              {connectionStatus === 'success'
                ? (
                    <CheckCircle className="h-4 w-4" />
                  )
                : (
                    <AlertCircle className="h-4 w-4" />
                  )}
              <span>
                {connectionStatus === 'success'
                  ? 'Connection successful!'
                  : errorMessage || 'Connection failed'}
              </span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={isConnecting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isConnecting || !formData.name.trim() || !formData.url.trim()}
              className="flex items-center gap-2"
            >
              {isConnecting
                ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Testing Connection...
                    </>
                  )
                : (
                    <>
                      <Plus className="h-4 w-4" />
                      Add Server
                    </>
                  )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
