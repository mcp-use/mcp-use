import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/client/components/ui/dialog";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { Switch } from "@/client/components/ui/switch";
import { cn } from "@/client/lib/utils";
import { Cog, Copy, FileText, Shield } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { CustomHeader } from "./CustomHeadersEditor";
import { CustomHeadersEditor } from "./CustomHeadersEditor";

interface ConnectionSettingsFormProps {
  // Form state
  transportType: string;
  setTransportType: (value: string) => void;
  url: string;
  setUrl: (value: string) => void;
  connectionType: string;
  setConnectionType: (value: string) => void;
  customHeaders: CustomHeader[];
  setCustomHeaders: (headers: CustomHeader[]) => void;
  requestTimeout: string;
  setRequestTimeout: (value: string) => void;
  resetTimeoutOnProgress: string;
  setResetTimeoutOnProgress: (value: string) => void;
  maxTotalTimeout: string;
  setMaxTotalTimeout: (value: string) => void;
  proxyAddress: string;
  setProxyAddress: (value: string) => void;

  // OAuth fields
  clientId: string;
  setClientId: (value: string) => void;
  redirectUrl: string;
  setRedirectUrl: (value: string) => void;
  scope: string;
  setScope: (value: string) => void;

  // Auto-switch
  autoSwitch?: boolean;
  setAutoSwitch?: (value: boolean) => void;

  // Callbacks
  onConnect?: () => void;
  onSave?: () => void;
  onCancel?: () => void;

  // UI options
  variant?: "default" | "styled";
  showConnectButton?: boolean;
  showSaveButton?: boolean;
  showExportButton?: boolean;
  isConnecting?: boolean;
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
  clientId,
  setClientId,
  redirectUrl,
  setRedirectUrl,
  scope,
  setScope,
  autoSwitch,
  setAutoSwitch,
  onConnect,
  onSave,
  onCancel,
  variant = "default",
  showConnectButton = false,
  showSaveButton = false,
  showExportButton = false,
  isConnecting = false,
}: ConnectionSettingsFormProps) {
  // UI state for sub-dialogs
  const [headersDialogOpen, setHeadersDialogOpen] = useState(false);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [configDialogOpen, setConfigDialogOpen] = useState(false);

  // Note: we compute header enablement on-demand where needed to avoid unused vars

  const handleCopyConfig = async () => {
    if (!url.trim()) {
      toast.error("Please enter a URL first");
      return;
    }

    // Create a comprehensive config object with all current settings
    const config = {
      url,
      transportType: transportType === "SSE" ? "http" : "sse",
      connectionType,
      proxyConfig:
        connectionType === "Via Proxy" && proxyAddress.trim()
          ? {
              proxyAddress: proxyAddress.trim(),
              customHeaders: customHeaders.reduce(
                (acc, header) => {
                  if (header.name && header.value) {
                    acc[header.name] = header.value;
                  }
                  return acc;
                },
                {} as Record<string, string>
              ),
            }
          : undefined,
      customHeaders: customHeaders.reduce(
        (acc, header) => {
          if (header.name && header.value) {
            acc[header.name] = header.value;
          }
          return acc;
        },
        {} as Record<string, string>
      ),
      requestTimeout: Number.parseInt(requestTimeout, 10),
      resetTimeoutOnProgress: resetTimeoutOnProgress === "True",
      maxTotalTimeout: Number.parseInt(maxTotalTimeout, 10),
      oauth:
        clientId || scope
          ? {
              clientId,
              redirectUrl,
              scope,
            }
          : undefined,
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(config, null, 2));
      toast.success("Configuration copied to clipboard");
    } catch {
      toast.error("Failed to copy configuration to clipboard");
    }
  };

  const isStyled = variant === "styled";
  const inputClassName = isStyled
    ? "bg-white/10 border-white/20 text-white placeholder:text-white/50"
    : "";
  const labelClassName = isStyled ? "text-white/90" : "";
  const selectTriggerClassName = isStyled
    ? "bg-white/10 border-white/20 text-white"
    : "";
  const buttonClassName = isStyled
    ? "bg-white/10 border-white/20 text-white hover:bg-white/20"
    : "";

  // Handle paste event to detect config JSON
  const handlePaste = async (e: React.ClipboardEvent) => {
    const pastedText = e.clipboardData.getData("text");

    // Try to parse as JSON config
    try {
      const config = JSON.parse(pastedText);

      // Check if it looks like a connection config
      if (config.url && typeof config.url === "string") {
        e.preventDefault(); // Prevent default paste behavior

        // Populate form fields with config data
        setUrl(config.url);

        if (config.transportType) {
          setTransportType(
            config.transportType === "sse" ? "WebSocket" : "SSE"
          );
        }

        if (config.connectionType) {
          setConnectionType(config.connectionType);
        }

        if (config.proxyConfig?.proxyAddress) {
          setProxyAddress(config.proxyConfig.proxyAddress);
        }

        if (config.customHeaders) {
          const headers = Object.entries(config.customHeaders).map(
            ([name, value], index) => ({
              id: `header-${index}`,
              name,
              value: String(value),
            })
          );
          setCustomHeaders(headers);
        }

        if (config.requestTimeout) {
          setRequestTimeout(String(config.requestTimeout));
        }

        if (config.resetTimeoutOnProgress !== undefined) {
          setResetTimeoutOnProgress(
            config.resetTimeoutOnProgress ? "True" : "False"
          );
        }

        if (config.maxTotalTimeout) {
          setMaxTotalTimeout(String(config.maxTotalTimeout));
        }

        if (config.oauth) {
          setClientId(config.oauth.clientId || "");
          setRedirectUrl(config.oauth.redirectUrl || redirectUrl);
          setScope(config.oauth.scope || "");
        }

        toast.success("Configuration pasted and form populated");
      }
    } catch (error) {
      // Not valid JSON or not a config object, let default paste behavior continue
    }
  };

  // Handle Enter key to trigger connection
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      const target = e.target as HTMLElement;
      // Don't trigger if we're in a textarea (to allow multi-line input)
      if (target.tagName !== "TEXTAREA") {
        e.preventDefault();
        if (onConnect && url.trim()) {
          onConnect();
        }
      }
    }
  };

  return (
    <div className="space-y-4 relative @container" onKeyDown={handleKeyDown}>
      <h3 className="text-xl font-semibold text-white mb-4">Connect</h3>
      {/* Copy Config Button - positioned absolutely on styled variant */}
      {showExportButton && (
        <Button
          variant="ghost"
          onClick={handleCopyConfig}
          className={cn(
            isStyled
              ? "absolute top-0 right-0 text-white hover:bg-white/20 z-10 dark:hover:bg-white/20"
              : "w-full",
            !isStyled && "mb-2"
          )}
        >
          <Copy className="w-4 h-4 mr-2" />
          Copy Config
        </Button>
      )}

      {/* Transport Type */}
      <div className="space-y-2">
        <Label className={labelClassName}>Transport Type</Label>
        <Select value={transportType} onValueChange={setTransportType}>
          <SelectTrigger className={cn("w-full", selectTriggerClassName)}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="SSE">Streamable HTTP</SelectItem>
            <SelectItem value="WebSocket">Server-Sent Events (SSE)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* URL */}
      <div className="space-y-2">
        <Label className={labelClassName}>URL</Label>
        <Input
          placeholder="http://localhost:3001/sse"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onPaste={handlePaste}
          className={inputClassName}
        />
        <p
          className={cn(
            "text-xs text-muted-foreground",
            isStyled ? "text-white/60" : ""
          )}
        >
          Tip: You can paste a copied connection config (JSON) to auto-populate
          the form
        </p>
      </div>

      {/* Connection Type */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className={labelClassName}>Connection Type</Label>
          {setAutoSwitch && (
            <div className="flex items-center gap-2">
              <Label
                htmlFor="auto-switch"
                className={cn(
                  "text-xs cursor-pointer",
                  isStyled ? "text-white/70" : "text-muted-foreground"
                )}
              >
                Auto-switch
              </Label>
              <Switch
                id="auto-switch"
                checked={autoSwitch}
                onCheckedChange={(value) => {
                  setAutoSwitch(value);
                  localStorage.setItem(
                    "mcp-inspector-auto-switch",
                    String(value)
                  );
                }}
                className="scale-75"
              />
            </div>
          )}
        </div>
        <Select value={connectionType} onValueChange={setConnectionType}>
          <SelectTrigger className={cn("w-full", selectTriggerClassName)}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Direct">Direct</SelectItem>
            <SelectItem value="Via Proxy">Via Proxy</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Configuration Buttons Row */}
      <div className="flex flex-row gap-3 @lg:flex-col">
        {/* Authentication Button */}
        <Dialog open={authDialogOpen} onOpenChange={setAuthDialogOpen}>
          <DialogTrigger asChild>
            <div className="relative flex-1 ">
              <Button
                variant="outline"
                className={cn(
                  (clientId || scope) && "border-2",
                  "w-full justify-center hover:text-white cursor-pointer",
                  buttonClassName
                )}
              >
                <Shield className="w-4 h-4 mr-0" />
                Authentication
              </Button>
            </div>
          </DialogTrigger>
          <DialogContent className="w-[calc(100vw-2rem)] sm:w-full max-w-2xl max-h-[80vh] overflow-y-auto">
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
                  onChange={(e) => setClientId(e.target.value)}
                />
              </div>

              {/* Redirect URL */}
              <div className="space-y-2">
                <Label className="text-sm">Redirect URL</Label>
                <Input
                  value={redirectUrl}
                  onChange={(e) => setRedirectUrl(e.target.value)}
                />
              </div>

              {/* Scope */}
              <div className="space-y-2">
                <Label className="text-sm">Scope</Label>
                <Input
                  placeholder="Scope (space-separated)"
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                />
              </div>

              <div className="flex justify-end">
                <Button onClick={() => setAuthDialogOpen(false)}>Save</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Custom Headers Button */}
        <Dialog open={headersDialogOpen} onOpenChange={setHeadersDialogOpen}>
          <DialogTrigger asChild>
            <div className="relative flex-1 ">
              <Button
                variant="outline"
                className={cn(
                  "w-full justify-center hover:text-white cursor-pointer",
                  buttonClassName
                )}
              >
                <FileText className="w-4 h-4" />
                Custom Headers
              </Button>
            </div>
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
              className={cn(
                "flex-1  justify-center hover:text-white cursor-pointer",
                buttonClassName
              )}
            >
              <Cog className="w-4 h-4" />
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
                  onChange={(e) => setRequestTimeout(e.target.value)}
                />
              </div>

              {/* Reset Timeout on Progress */}
              <div className="space-y-2">
                <Label className="text-sm flex items-center gap-1">
                  Reset Timeout on Progress
                  <span className="text-muted-foreground text-xs">(?)</span>
                </Label>
                <Select
                  value={resetTimeoutOnProgress}
                  onValueChange={setResetTimeoutOnProgress}
                >
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
                  onChange={(e) => setMaxTotalTimeout(e.target.value)}
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
                  onChange={(e) => setProxyAddress(e.target.value)}
                  placeholder=""
                />
              </div>

              <div className="flex justify-end">
                <Button onClick={() => setConfigDialogOpen(false)}>Save</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Connect Button */}
      {showConnectButton && (
        <Button
          onClick={onConnect}
          disabled={!url.trim() || isConnecting}
          className={cn(
            "w-full font-semibold",
            isStyled ? "bg-white text-black hover:bg-white/90" : ""
          )}
        >
          {isConnecting ? (
            <>
              <svg
                className="w-4 h-4 mr-2 animate-spin"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              Connecting...
            </>
          ) : (
            <>
              <svg
                className="w-4 h-4 mr-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
              Connect
            </>
          )}
        </Button>
      )}

      {/* Action Buttons */}
      {showSaveButton && (
        <div className="flex justify-end gap-2">
          {onCancel && (
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button onClick={onSave}>Save Connection Options</Button>
        </div>
      )}
    </div>
  );
}
