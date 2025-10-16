import type { CustomHeader } from './CustomHeadersEditor'
import { Cog, FileText, Shield } from 'lucide-react'
import React, { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CustomHeadersEditor } from './CustomHeadersEditor'

interface ConnectionSettingsFormProps {
  // Form state
  transportType: string
  setTransportType: (value: string) => void
  url: string
  setUrl: (value: string) => void
  connectionType: string
  setConnectionType: (value: string) => void
  customHeaders: CustomHeader[]
  setCustomHeaders: (headers: CustomHeader[]) => void
  requestTimeout: string
  setRequestTimeout: (value: string) => void
  resetTimeoutOnProgress: string
  setResetTimeoutOnProgress: (value: string) => void
  maxTotalTimeout: string
  setMaxTotalTimeout: (value: string) => void
  proxyAddress: string
  setProxyAddress: (value: string) => void
  proxyToken: string
  setProxyToken: (value: string) => void
  
  // OAuth fields
  clientId: string
  setClientId: (value: string) => void
  redirectUrl: string
  setRedirectUrl: (value: string) => void
  scope: string
  setScope: (value: string) => void
  
  // Callbacks
  onSave?: () => void
  onCancel?: () => void
  showSaveButton?: boolean
}

export function ConnectionSettingsForm({
  transportType,
  setTransportType,
  url,
  setUrl,
  connectionType,
  setConnectionType,
  customHeaders,
  setCustomHeaders,
  requestTimeout,
  setRequestTimeout,
  resetTimeoutOnProgress,
  setResetTimeoutOnProgress,
  maxTotalTimeout,
  setMaxTotalTimeout,
  proxyAddress,
  setProxyAddress,
  proxyToken,
  setProxyToken,
  clientId,
  setClientId,
  redirectUrl,
  setRedirectUrl,
  scope,
  setScope,
  onSave,
  onCancel,
  showSaveButton = true,
}: ConnectionSettingsFormProps) {
  // UI state for sub-dialogs
  const [headersDialogOpen, setHeadersDialogOpen] = useState(false)
  const [authDialogOpen, setAuthDialogOpen] = useState(false)
  const [configDialogOpen, setConfigDialogOpen] = useState(false)

  const enabledHeadersCount = customHeaders.filter(h => h.name && h.value).length

  return (
    <div className="space-y-4">
      {/* Transport Type */}
      <div className="space-y-2">
        <Label>Transport Type</Label>
        <Select value={transportType} onValueChange={setTransportType}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="SSE">Streamable HTTP</SelectItem>
            <SelectItem value="WebSocket">WebSocket</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* URL */}
      <div className="space-y-2">
        <Label>URL</Label>
        <Input
          placeholder="http://localhost:3001/sse"
          value={url}
          onChange={e => setUrl(e.target.value)}
        />
      </div>

      {/* Connection Type */}
      <div className="space-y-2">
        <Label>Connection Type</Label>
        <Select value={connectionType} onValueChange={setConnectionType}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Direct">Direct</SelectItem>
            <SelectItem value="Via Proxy">Via Proxy</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Configuration Buttons Row */}
      <div className="flex gap-3">
        {/* Authentication Button */}
        <Dialog open={authDialogOpen} onOpenChange={setAuthDialogOpen}>
          <DialogTrigger asChild>
            <Button
              variant="outline"
              className="flex-1 justify-center"
            >
              <Shield className="w-4 h-4 mr-2" />
              Authentication
              {(clientId || scope) && (
                <Badge variant="secondary" className="ml-2">
                  OAuth 2.0
                </Badge>
              )}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Authentication</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <h4 className="text-sm font-medium">OAuth 2.0 Flow</h4>

              {/* Client ID */}
              <div className="space-y-2">
                <Label className="text-sm">Client ID</Label>
                <Input
                  placeholder="Client ID"
                  value={clientId}
                  onChange={e => setClientId(e.target.value)}
                />
              </div>

              {/* Redirect URL */}
              <div className="space-y-2">
                <Label className="text-sm">Redirect URL</Label>
                <Input
                  value={redirectUrl}
                  onChange={e => setRedirectUrl(e.target.value)}
                />
              </div>

              {/* Scope */}
              <div className="space-y-2">
                <Label className="text-sm">Scope</Label>
                <Input
                  placeholder="Scope (space-separated)"
                  value={scope}
                  onChange={e => setScope(e.target.value)}
                />
              </div>

              <div className="flex justify-end">
                <Button onClick={() => setAuthDialogOpen(false)}>
                  Save
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Custom Headers Button */}
        <Dialog open={headersDialogOpen} onOpenChange={setHeadersDialogOpen}>
          <DialogTrigger asChild>
            <Button
              variant="outline"
              className="flex-1 justify-center"
            >
              <FileText className="w-4 h-4 mr-2" />
              Custom Headers
              {enabledHeadersCount > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {enabledHeadersCount}
                </Badge>
              )}
            </Button>
          </DialogTrigger>
          <DialogContent className="w-full max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Custom Headers</DialogTitle>
            </DialogHeader>
            <CustomHeadersEditor
              headers={customHeaders}
              onChange={setCustomHeaders}
              onSave={() => setHeadersDialogOpen(false)}
            />
          </DialogContent>
        </Dialog>

        {/* Configuration Button */}
        <Dialog open={configDialogOpen} onOpenChange={setConfigDialogOpen}>
          <DialogTrigger asChild>
            <Button
              variant="outline"
              className="flex-1 justify-center cursor-pointer"
            >
              <Cog className="w-4 h-4 mr-2" />
              Configuration
            </Button>
          </DialogTrigger>
          <DialogContent className="w-full max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Configuration</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {/* Request Timeout */}
              <div className="space-y-2">
                <Label className="text-sm flex items-center gap-1">
                  Request Timeout
                  <span className="text-muted-foreground text-xs">(?)</span>
                </Label>
                <Input
                  type="number"
                  value={requestTimeout}
                  onChange={e => setRequestTimeout(e.target.value)}
                />
              </div>

              {/* Reset Timeout on Progress */}
              <div className="space-y-2">
                <Label className="text-sm flex items-center gap-1">
                  Reset Timeout on Progress
                  <span className="text-muted-foreground text-xs">(?)</span>
                </Label>
                <Select value={resetTimeoutOnProgress} onValueChange={setResetTimeoutOnProgress}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="True">True</SelectItem>
                    <SelectItem value="False">False</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Maximum Total Timeout */}
              <div className="space-y-2">
                <Label className="text-sm flex items-center gap-1">
                  Maximum Total Timeout
                  <span className="text-muted-foreground text-xs">(?)</span>
                </Label>
                <Input
                  type="number"
                  value={maxTotalTimeout}
                  onChange={e => setMaxTotalTimeout(e.target.value)}
                />
              </div>

              {/* Inspector Proxy Address */}
              <div className="space-y-2">
                <Label className="text-sm flex items-center gap-1">
                  Inspector Proxy Address
                  <span className="text-muted-foreground text-xs">(?)</span>
                </Label>
                <Input
                  value={proxyAddress}
                  onChange={e => setProxyAddress(e.target.value)}
                  placeholder=""
                />
              </div>

              {/* Proxy Session Token */}
              <div className="space-y-2">
                <Label className="text-sm flex items-center gap-1">
                  Proxy Session Token
                  <span className="text-muted-foreground text-xs">(?)</span>
                </Label>
                <Input
                  value={proxyToken}
                  onChange={e => setProxyToken(e.target.value)}
                  className="font-mono text-xs"
                />
              </div>

              <div className="flex justify-end">
                <Button onClick={() => setConfigDialogOpen(false)}>
                  Save
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Action Buttons */}
      {showSaveButton && (
        <div className="flex justify-end gap-2">
          {onCancel && (
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button onClick={onSave}>
            Save Connection Options
          </Button>
        </div>
      )}
    </div>
  )
}
