import { Button } from "@/client/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/client/components/ui/card";
import {
  Dialog,
  DialogBody,
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
import { cn } from "@/client/lib/utils";
import { copyToClipboard } from "@/client/utils/browser";
import { Cog, Copy, FileText, Shield } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import type { CustomHeader } from "./CustomHeadersEditor";
import { CustomHeadersEditor } from "./CustomHeadersEditor";
import {
  normalizeConnectionMode,
  protocolModeFromNegotiation,
  protocolNegotiationForMode,
  type ConnectionMode,
  type InspectorProtocolMode,
} from "@/client/utils/connectionUpdates";

export interface ConnectionSettingsFormProps {
  // Form state
  alias: string;
  setAlias: (value: string) => void;
  url: string;
  setUrl: (value: string) => void;
  connectionMode: ConnectionMode;
  setConnectionMode: (value: ConnectionMode) => void;
  protocolMode: InspectorProtocolMode;
  setProtocolMode: (value: InspectorProtocolMode) => void;
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
  clientSecret: string;
  setClientSecret: (value: string) => void;
  scope: string;
  setScope: (value: string) => void;

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
  inlineSections?: boolean;
  /** When true with inlineSections, each group renders in its own settings card. */
  cardSections?: boolean;
  /** Optional consumer validation for the URL field. Return an error message to block Connect. */
  validateUrl?: (value: string) => string | undefined;
}

/**
 * Renders a connection settings form with controls for URL, connection type, OAuth, headers, and timeouts; supports copying the current configuration to the clipboard and pasting a JSON configuration to populate the form.
 *
 * The form manages sub-dialogs for Authentication, Custom Headers, and Configuration, handles Enter to trigger connection, and conditionally shows Connect/Save/Copy buttons based on props.
 *
 * @param onConnect - Callback invoked when the user triggers a connection (e.g., Connect button or Enter key)
 * @param onSave - Callback invoked when the user saves connection options via the Save Connection Options button
 * @param onCancel - Callback invoked when the user cancels editing (optional)
 * @param variant - Visual variant of the form; "styled" applies a dark/styled appearance
 * @param showConnectButton - When true, renders the Connect button
 * @param showSaveButton - When true, renders Save and optional Cancel actions
 * @param showExportButton - When true, renders the Copy Config button that copies a JSON config to the clipboard
 * @param isConnecting - When true, disables the Connect button and shows a connecting state
 *
 * @returns The JSX element for the connection settings form
 */
export function ConnectionSettingsForm({
  alias,
  setAlias,
  url,
  setUrl,
  connectionMode,
  setConnectionMode,
  protocolMode,
  setProtocolMode,
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
  clientSecret,
  setClientSecret,
  scope,
  setScope,
  onConnect,
  onSave,
  onCancel,
  variant = "default",
  showConnectButton = false,
  showSaveButton = false,
  showExportButton = false,
  isConnecting = false,
  inlineSections = false,
  cardSections = false,
  validateUrl,
}: ConnectionSettingsFormProps) {
  // UI state for sub-dialogs
  const [headersDialogOpen, setHeadersDialogOpen] = useState(false);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const isComposingRef = useRef(false);

  // Note: we compute header enablement on-demand where needed to avoid unused vars

  const handleCopyConfig = async () => {
    if (!url.trim()) {
      toast.error("Please enter a URL first");
      return;
    }

    // Create a comprehensive config object with all current settings
    const config = {
      url,
      ...(alias.trim() ? { name: alias.trim() } : {}),
      transportType: "http", // HTTP only - SSE is deprecated
      connectionMode,
      protocolNegotiation: protocolNegotiationForMode(protocolMode),
      connectionType: connectionMode === "proxy" ? "Via Proxy" : "Direct",
      proxyConfig:
        connectionMode === "proxy" && proxyAddress.trim()
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
      autoProxyFallback:
        connectionMode === "auto" && proxyAddress.trim()
          ? {
              enabled: true,
              proxyAddress: proxyAddress.trim(),
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
              ...(clientId && clientSecret ? { clientSecret } : {}),
              scope,
            }
          : undefined,
    };

    try {
      await copyToClipboard(JSON.stringify(config, null, 2));
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
  const buttonClassName = isStyled
    ? "bg-white/10 border-white/20 text-white hover:bg-white/20"
    : "";
  const urlValidationError = validateUrl?.(url.trim());

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
        setAlias(
          typeof config.name === "string" && config.name !== config.url
            ? config.name
            : ""
        );

        // Transport type is always HTTP now (SSE is deprecated)
        // No need to set transportType from config

        const pastedProxyAddress =
          config.proxyConfig?.proxyAddress ||
          (typeof config.autoProxyFallback === "object"
            ? config.autoProxyFallback.proxyAddress
            : undefined);
        setConnectionMode(
          normalizeConnectionMode(
            config.connectionMode,
            config.connectionType,
            !!pastedProxyAddress
          )
        );
        setProtocolMode(
          protocolModeFromNegotiation(config.protocolNegotiation)
        );

        if (pastedProxyAddress) {
          setProxyAddress(pastedProxyAddress);
        }

        // Extract headers from proxyConfig (preferred) or top-level customHeaders/headers
        const headersToExtract =
          config.proxyConfig?.customHeaders ||
          config.proxyConfig?.headers ||
          config.customHeaders ||
          config.headers ||
          {};

        if (Object.keys(headersToExtract).length > 0) {
          const headers = Object.entries(headersToExtract).map(
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
          setClientSecret(config.oauth.clientSecret || "");
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
    if (
      isComposingRef.current ||
      e.nativeEvent.isComposing ||
      e.keyCode === 229
    ) {
      return;
    }

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

  const authenticationFields = (
    <div className="grid gap-4 sm:grid-cols-2">
      {!cardSections && (
        <h4 className="text-sm font-medium sm:col-span-2">OAuth 2.0</h4>
      )}
      <div className="space-y-2">
        <Label className="text-sm">Client ID</Label>
        <Input
          data-testid="auth-dialog-client-id-input"
          placeholder="Client ID"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label className="text-sm">Client Secret</Label>
        <Input
          data-testid="auth-dialog-client-secret-input"
          type="password"
          placeholder="Client Secret (optional)"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Used only for the current connection flow.
        </p>
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label className="text-sm">Scope</Label>
        <Input
          data-testid="auth-dialog-scope-input"
          placeholder="Scope (space-separated)"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
        />
      </div>
    </div>
  );

  const headersFields = (
    <CustomHeadersEditor
      title={<></>}
      headers={customHeaders}
      onChange={setCustomHeaders}
    />
  );

  const protocolFields = ({
    testId,
    styled = false,
    showHelpText = false,
  }: {
    testId: string;
    styled?: boolean;
    showHelpText?: boolean;
  }) => (
    <div className="space-y-2">
      <Label className={cn("text-sm", styled && labelClassName)}>
        Protocol Version
      </Label>
      <Select
        value={protocolMode}
        onValueChange={(value) =>
          setProtocolMode(value as InspectorProtocolMode)
        }
      >
        <SelectTrigger
          className={cn("w-full", styled && inputClassName)}
          data-testid={testId}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">Auto</SelectItem>
          <SelectItem value="v1">Legacy (2025-11-25)</SelectItem>
          <SelectItem value="v2">Modern (2026-07-28)</SelectItem>
        </SelectContent>
      </Select>
      {showHelpText && (
        <p className="text-xs text-muted-foreground">
          Auto probes for Modern and falls back to the Legacy initialize flow.
          Legacy and modern modes fail when the server is incompatible.
        </p>
      )}
    </div>
  );

  const configurationFields = (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label className="text-sm">Connection Mode</Label>
        <Select
          value={connectionMode}
          onValueChange={(value) => setConnectionMode(value as ConnectionMode)}
        >
          <SelectTrigger
            className="w-full"
            data-testid="config-dialog-connection-mode-select"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto</SelectItem>
            <SelectItem value="direct">Direct</SelectItem>
            <SelectItem value="proxy">Proxy</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Auto tries a direct connection first and falls back to the proxy.
          Direct bypasses the proxy; Proxy always routes through it.
        </p>
      </div>
      {protocolFields({
        testId: "connection-settings-protocol-mode-select",
        showHelpText: true,
      })}
      <div className="space-y-2">
        <Label className="text-sm">Proxy Endpoint</Label>
        <Input
          data-testid="config-dialog-proxy-address-input"
          value={proxyAddress}
          onChange={(e) => setProxyAddress(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label className="text-sm">Request Timeout</Label>
        <Input
          data-testid="config-dialog-request-timeout-input"
          type="number"
          value={requestTimeout}
          onChange={(e) => setRequestTimeout(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label className="text-sm">Maximum Total Timeout</Label>
        <Input
          data-testid="config-dialog-max-timeout-input"
          type="number"
          value={maxTotalTimeout}
          onChange={(e) => setMaxTotalTimeout(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label className="text-sm">Reset Timeout on Progress</Label>
        <Select
          value={resetTimeoutOnProgress}
          onValueChange={setResetTimeoutOnProgress}
        >
          <SelectTrigger
            className="w-full"
            data-testid="config-dialog-reset-timeout-select"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="True">True</SelectItem>
            <SelectItem value="False">False</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );

  const endpointFields = (
    <div
      className={
        inlineSections || cardSections
          ? "grid gap-4 sm:grid-cols-2"
          : "space-y-4"
      }
    >
      <div className="space-y-2">
        <Label className={labelClassName}>Alias</Label>
        <Input
          data-testid="connection-form-alias-input"
          placeholder="Optional server alias"
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
          className={inputClassName}
        />
      </div>

      <div className="space-y-2">
        <Label className={labelClassName}>URL</Label>
        <Input
          data-testid="connection-form-url-input"
          placeholder="http://localhost:3000"
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
        {urlValidationError && (
          <p className="text-xs text-destructive" role="alert">
            {urlValidationError}
          </p>
        )}
      </div>
    </div>
  );

  const formShellProps = {
    onCompositionStart: () => {
      isComposingRef.current = true;
    },
    onCompositionEnd: () => {
      isComposingRef.current = false;
    },
    onKeyDown: handleKeyDown,
  };

  const copyConfigButton = showExportButton ? (
    <Button
      data-testid="connection-form-copy-config-button"
      variant="ghost"
      onClick={handleCopyConfig}
      className={cn(
        isStyled
          ? "absolute top-0 right-0 z-10 text-white hover:bg-white/20 dark:hover:bg-white/20"
          : "w-full",
        !isStyled && "mb-2"
      )}
    >
      <Copy className="mr-2 h-4 w-4" />
      Copy Config
    </Button>
  ) : null;

  if (inlineSections && cardSections) {
    return (
      <div className="relative space-y-6 @container" {...formShellProps}>
        {copyConfigButton}
        <Card className="border">
          <CardHeader>
            <CardTitle className="text-base font-medium">Endpoint</CardTitle>
            <CardDescription>MCP server URL and display alias</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">{endpointFields}</CardContent>
        </Card>
        <Card className="border">
          <CardHeader>
            <CardTitle className="text-base font-medium">
              Configuration
            </CardTitle>
            <CardDescription>
              Connection mode, protocol, proxy, and request timeouts
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">{configurationFields}</CardContent>
        </Card>
        <Card className="border">
          <CardHeader>
            <CardTitle className="text-base font-medium">
              Authentication
            </CardTitle>
            <CardDescription>OAuth 2.0 client credentials</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">{authenticationFields}</CardContent>
        </Card>
        <Card className="border">
          <CardHeader>
            <CardTitle className="text-base font-medium">
              Custom Headers
            </CardTitle>
            <CardDescription>
              Extra HTTP headers sent with MCP requests
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">{headersFields}</CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="relative space-y-4 @container" {...formShellProps}>
      {!inlineSections && (
        <h3 className="mb-4 text-xl font-semibold text-white">Connect</h3>
      )}
      {copyConfigButton}

      {endpointFields}

      {!inlineSections &&
        protocolFields({
          testId: "connection-form-protocol-mode-select",
          styled: isStyled,
        })}

      {inlineSections && !cardSections && (
        <div className="space-y-8 pt-2">
          <section className="space-y-4">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Authentication
            </h3>
            {authenticationFields}
          </section>
          <section className="space-y-4">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Custom Headers
            </h3>
            {headersFields}
          </section>
          <section className="space-y-4">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Configuration
            </h3>
            {configurationFields}
          </section>
        </div>
      )}

      {/* Configuration Buttons Row */}
      {!inlineSections && (
        <div className="flex flex-row gap-3 @lg:flex-col">
          {/* Authentication Button */}
          <Dialog open={authDialogOpen} onOpenChange={setAuthDialogOpen}>
            <DialogTrigger
              render={
                <div className="relative flex-1 ">
                  <Button
                    data-testid="connection-form-auth-button"
                    variant="outline"
                    className={cn(
                      (clientId || clientSecret || scope) && "border-2",
                      "w-full justify-center hover:text-white cursor-pointer",
                      buttonClassName
                    )}
                  >
                    <Shield className="w-4 h-4 mr-0" />
                    Authentication
                  </Button>
                </div>
              }
              nativeButton={false}
            />
            <DialogContent
              scrollable
              className="w-[calc(100vw-2rem)] sm:w-full max-w-2xl max-h-[80vh]"
            >
              <DialogHeader>
                <DialogTitle>Authentication</DialogTitle>
              </DialogHeader>
              <DialogBody className="space-y-4">
                {authenticationFields}
                <div className="flex justify-end">
                  <Button onClick={() => setAuthDialogOpen(false)}>Save</Button>
                </div>
              </DialogBody>
            </DialogContent>
          </Dialog>

          {/* Custom Headers Button */}
          <Dialog open={headersDialogOpen} onOpenChange={setHeadersDialogOpen}>
            <DialogTrigger
              render={
                <div className="relative flex-1 ">
                  <Button
                    data-testid="connection-form-headers-button"
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
              }
              nativeButton={false}
            />
            <DialogContent scrollable className="w-full max-w-2xl max-h-[80vh]">
              <DialogHeader>
                <DialogTitle>Custom Headers</DialogTitle>
              </DialogHeader>
              <DialogBody>
                <CustomHeadersEditor
                  title={<></>}
                  headers={customHeaders}
                  onChange={setCustomHeaders}
                  onSave={() => setHeadersDialogOpen(false)}
                />
              </DialogBody>
            </DialogContent>
          </Dialog>

          {/* Configuration Button */}
          <Dialog open={configDialogOpen} onOpenChange={setConfigDialogOpen}>
            <DialogTrigger
              render={
                <Button
                  data-testid="connection-form-config-button"
                  variant="outline"
                  className={cn(
                    "flex-1  justify-center hover:text-white cursor-pointer",
                    buttonClassName
                  )}
                >
                  <Cog className="w-4 h-4" />
                  Configuration
                </Button>
              }
              nativeButton
            />
            <DialogContent scrollable className="w-full max-w-2xl max-h-[80vh]">
              <DialogHeader>
                <DialogTitle>Configuration</DialogTitle>
              </DialogHeader>
              <DialogBody className="space-y-4">
                {configurationFields}
                <div className="flex justify-end">
                  <Button onClick={() => setConfigDialogOpen(false)}>
                    Save
                  </Button>
                </div>
              </DialogBody>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {/* Connect Button */}
      {showConnectButton && (
        <Button
          data-testid="connection-form-connect-button"
          onClick={onConnect}
          disabled={!url.trim() || Boolean(urlValidationError) || isConnecting}
          size={isStyled ? "lg" : undefined}
          className={cn(
            "w-full font-semibold",
            isStyled
              ? "rounded-full text-black [&_[aria-hidden]]:bg-white hover:[&_[aria-hidden]]:bg-white/90 group-active:[&_[aria-hidden]]:bg-white/80"
              : ""
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
          <Button data-testid="connection-form-save-button" onClick={onSave}>
            Save Connection Options
          </Button>
        </div>
      )}
    </div>
  );
}
