import type { Resource } from "@modelcontextprotocol/sdk/types.js";
import {
  Braces,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Maximize2,
  Monitor,
  MousePointer2,
  PictureInPicture,
  Pointer,
  Settings,
  ShieldCheck,
  ShieldOff,
  Smartphone,
  SquareDashedMousePointer,
  Tablet,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { LOCALE_OPTIONS, TIMEZONE_OPTIONS } from "../constants/debug-options";
import {
  useWidgetDebug,
  type CspViolation,
  type WidgetDeclaredCsp,
} from "../context/WidgetDebugContext";
import { useResourceProps, type PropPreset } from "../hooks/useResourceProps";
import type { LLMConfig } from "./chat/types";
import { IframeConsole } from "./IframeConsole";
import { PropsConfigDialog } from "./resources/PropsConfigDialog";
import { JSONDisplay } from "./shared/JSONDisplay";
import { SafeAreaInsetsEditor } from "./ui-playground/shared/SafeAreaInsetsEditor";
import { Button } from "./ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

interface MCPAppsDebugControlsProps {
  displayMode: "inline" | "pip" | "fullscreen";
  onDisplayModeChange: (mode: "inline" | "pip" | "fullscreen") => void;
  toolCallId: string;
  // Props selection
  propsContext: "tool" | "resource";
  resourceUri: string;
  toolInput?: Record<string, unknown>;
  resourceAnnotations?: Record<string, unknown>;
  llmConfig?: LLMConfig | null;
  resource?: Resource | null;
  onPropsChange?: (props: Record<string, string> | null) => void;
  /** When set, auto-opens the props popover with a hint listing these required prop names */
  requiredProps?: string[];
  // Dual-protocol support
  protocol?: "apps-sdk" | "mcp-apps";
  onUpdateGlobals?: (updates: {
    displayMode?: "inline" | "pip" | "fullscreen";
    theme?: "light" | "dark";
    maxHeight?: number;
    locale?: string;
    safeArea?: {
      insets: { top: number; bottom: number; left: number; right: number };
    };
    userAgent?: any;
  }) => void;
}

const NO_PROPS_VALUE = "__no_props__";
const TOOL_PROPS_VALUE = "__tool_props__";
const CREATE_PRESET_VALUE = "__create_preset__";

/**
 * Compute suggested CSP domains to add from blocked violations.
 * Merges with current declared CSP and dedupes.
 */
function computeSuggestedFix(
  violations: CspViolation[],
  currentDeclared?: WidgetDeclaredCsp
): {
  connectDomains: string[];
  resourceDomains: string[];
  frameDomains?: string[];
} {
  const connectSet = new Set(currentDeclared?.connectDomains ?? []);
  const resourceSet = new Set(currentDeclared?.resourceDomains ?? []);
  const frameSet = new Set(currentDeclared?.frameDomains ?? []);

  const RESOURCE_DIRECTIVES = new Set([
    "script-src",
    "style-src",
    "img-src",
    "font-src",
    "media-src",
  ]);
  const CONNECT_DIRECTIVE = "connect-src";
  const FRAME_DIRECTIVE = "frame-src";

  for (const v of violations) {
    const uri = (v.blockedUri || "").trim();
    if (
      !uri ||
      uri === "(inline)" ||
      uri.startsWith("blob:") ||
      uri.startsWith("data:")
    ) {
      continue;
    }
    let origin: string | null = null;
    try {
      const url = new URL(uri);
      origin = url.origin;
    } catch {
      continue;
    }
    if (!origin) continue;

    const dir = (v.effectiveDirective || v.directive || "").toLowerCase();

    if (dir === CONNECT_DIRECTIVE) {
      connectSet.add(origin);
      if (origin.startsWith("http://")) {
        connectSet.add(origin.replace("http://", "ws://"));
      } else if (origin.startsWith("https://")) {
        connectSet.add(origin.replace("https://", "wss://"));
      }
    } else if (RESOURCE_DIRECTIVES.has(dir)) {
      resourceSet.add(origin);
    } else if (dir === FRAME_DIRECTIVE) {
      frameSet.add(origin);
    }
  }

  const result: {
    connectDomains: string[];
    resourceDomains: string[];
    frameDomains?: string[];
  } = {
    connectDomains: Array.from(connectSet).sort(),
    resourceDomains: Array.from(resourceSet).sort(),
  };
  if (frameSet.size > 0) {
    result.frameDomains = Array.from(frameSet).sort();
  }
  return result;
}

const MCP_APPS_CSP_SPEC_URL =
  "https://raw.githubusercontent.com/modelcontextprotocol/ext-apps/bcfffb6585ea4fb1e3a9da39fb8911b83399fa71/specification/2026-01-26/apps.mdx";
const MCP_USE_CSP_DOCS_URL = "https://mcp-use.com/docs/typescript/server/csp";

/**
 * Build an agent prompt to fix CSP violations.
 * Includes context, current CSP, violations, and suggested fix for an agent to apply.
 * Only call when violations.length > 0.
 */
function buildAgentCspPrompt(
  declaredCsp: WidgetDeclaredCsp | undefined,
  effectivePolicy: string | undefined,
  violations: CspViolation[],
  suggestedFix: {
    connectDomains: string[];
    resourceDomains: string[];
    frameDomains?: string[];
  } | null
): string {
  const lines: string[] = [
    "Fix the Content Security Policy (CSP) for this MCP Apps widget. The widget has CSP violations that block network requests and resources.",
    "",
    "**References:**",
    `- MCP Apps CSP spec: ${MCP_APPS_CSP_SPEC_URL}`,
    `- mcp-use CSP docs: ${MCP_USE_CSP_DOCS_URL}`,
    "",
  ];

  lines.push("**Current declared CSP:**");
  if (declaredCsp) {
    lines.push(
      `connectDomains: ${JSON.stringify(declaredCsp.connectDomains ?? [])}`
    );
    lines.push(
      `resourceDomains: ${JSON.stringify(declaredCsp.resourceDomains ?? [])}`
    );
    lines.push(
      `frameDomains: ${JSON.stringify(declaredCsp.frameDomains ?? [])}`
    );
    lines.push(
      `baseUriDomains: ${JSON.stringify(declaredCsp.baseUriDomains ?? [])}`
    );
  } else {
    lines.push("No CSP declared.");
  }
  lines.push("");

  if (effectivePolicy) {
    lines.push("**Effective policy (originalPolicy):**");
    lines.push("```");
    lines.push(effectivePolicy);
    lines.push("```");
    lines.push("");
  }

  if (violations.length > 0) {
    lines.push(`**Blocked requests (${violations.length}):**`);
    for (const v of violations) {
      const dir = v.effectiveDirective || v.directive;
      const uri = v.blockedUri || "(inline)";
      lines.push(`- ${dir}: ${uri}`);
    }
    lines.push("");
  }

  if (suggestedFix) {
    lines.push("**Apply this CSP config to fix the violations:**");
    lines.push(
      'Add these domains to the widget\'s CSP metadata (appsSdkMetadata["openai/widgetCSP"] or resource _meta.ui.csp). Use camelCase for MCP Apps (connectDomains, resourceDomains) or snake_case for OpenAI format (connect_domains, resource_domains).'
    );
    lines.push("");
    lines.push("```json");
    lines.push(
      JSON.stringify(
        {
          connectDomains: suggestedFix.connectDomains,
          resourceDomains: suggestedFix.resourceDomains,
          ...(suggestedFix.frameDomains?.length
            ? { frameDomains: suggestedFix.frameDomains }
            : {}),
        },
        null,
        2
      )
    );
    lines.push("```");
  } else {
    lines.push("No blocked requests - no fix needed.");
  }

  return lines.join("\n");
}

export function MCPAppsDebugControls({
  displayMode,
  onDisplayModeChange,
  toolCallId,
  propsContext,
  resourceUri,
  toolInput,
  resourceAnnotations,
  llmConfig,
  resource,
  onPropsChange,
  requiredProps,
  protocol = "mcp-apps",
  onUpdateGlobals,
}: MCPAppsDebugControlsProps) {
  const { playground, updatePlaygroundSettings, widgets, clearCspViolations } =
    useWidgetDebug();
  const widget = widgets.get(toolCallId);
  const cspViolations = widget?.cspViolations ?? [];
  const declaredCsp = widget?.declaredCsp;
  const effectivePolicy = widget?.effectivePolicy;
  const suggestedFix =
    playground.cspMode === "widget-declared" && cspViolations.length > 0
      ? computeSuggestedFix(cspViolations, declaredCsp)
      : null;
  const agentPrompt =
    cspViolations.length > -1
      ? buildAgentCspPrompt(
          declaredCsp,
          effectivePolicy,
          cspViolations,
          suggestedFix
        )
      : "";
  const isFullscreen = displayMode === "fullscreen";
  const isPip = displayMode === "pip";
  const isAppsSdk = protocol === "apps-sdk";

  // Props management
  const {
    presets,
    activePresetId,
    savePreset,
    deletePreset,
    setActivePreset,
    getActiveProps,
  } = useResourceProps(resourceUri);
  const [propsDialogOpen, setPropsDialogOpen] = useState(false);

  // Controlled props popover — auto-opens when required props are missing
  const hasRequiredProps = !!requiredProps?.length;
  const missingProps = hasRequiredProps && !activePresetId;
  const [propsPopoverOpen, setPropsPopoverOpen] = useState(() => missingProps);

  useEffect(() => {
    if (missingProps) setPropsPopoverOpen(true);
  }, [missingProps]);
  const [editingPreset, setEditingPreset] = useState<PropPreset | null>(null);
  const [deviceDialogOpen, setDeviceDialogOpen] = useState(false);
  const [localeDialogOpen, setLocaleDialogOpen] = useState(false);
  const [timezoneDialogOpen, setTimezoneDialogOpen] = useState(false);
  const [cspDialogOpen, setCspDialogOpen] = useState(false);
  const [cspDeclaredExpanded, setCspDeclaredExpanded] = useState(true);
  const [cspPolicyExpanded, setCspPolicyExpanded] = useState(true);
  const [cspSuggestedExpanded, setCspSuggestedExpanded] = useState(true);

  // Determine default select value based on context
  const getDefaultSelectValue = useCallback(() => {
    if (propsContext === "tool" && toolInput) {
      return TOOL_PROPS_VALUE;
    }
    return NO_PROPS_VALUE;
  }, [propsContext, toolInput]);

  const [selectValue, setSelectValue] = useState<string>(
    getDefaultSelectValue()
  );

  // Update select value when active preset changes.
  // In tool context, never auto-apply a localStorage preset on mount —
  // the tool result's structuredContent is authoritative. The user can
  // still manually pick a preset from the dropdown.
  useEffect(() => {
    if (activePresetId && propsContext !== "tool") {
      setSelectValue(activePresetId);
    } else if (
      selectValue !== NO_PROPS_VALUE &&
      selectValue !== TOOL_PROPS_VALUE
    ) {
      setSelectValue(getDefaultSelectValue());
    }
  }, [activePresetId, selectValue, getDefaultSelectValue, propsContext]);

  // Notify parent of props changes
  useEffect(() => {
    if (!onPropsChange) return;

    if (selectValue === NO_PROPS_VALUE || selectValue === TOOL_PROPS_VALUE) {
      // Both "None" and "Tool Props" mean no custom override — use natural tool result flow.
      // Per SEP-1865, widget props come from structuredContent in the tool result, not from
      // tool call arguments; overriding with args would erase the real structured data.
      onPropsChange(null);
    } else if (activePresetId) {
      const props = getActiveProps();
      onPropsChange(props);
    }
  }, [selectValue, activePresetId, toolInput, getActiveProps, onPropsChange]);

  const handleValueChange = (value: string) => {
    if (value === CREATE_PRESET_VALUE) {
      setEditingPreset(null);
      setPropsDialogOpen(true);
      return;
    }

    if (value === NO_PROPS_VALUE || value === TOOL_PROPS_VALUE) {
      setActivePreset(null);
      setSelectValue(value);
    } else {
      setActivePreset(value);
      setSelectValue(value);
    }
  };

  const handleSavePreset = (preset: PropPreset) => {
    savePreset(preset);
    setActivePreset(preset.id);
    setSelectValue(preset.id);
  };

  const handleDeletePreset = (presetId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const preset = presets.find((p) => p.id === presetId);
    if (preset) {
      deletePreset(presetId);
      toast.success("Preset deleted", {
        description: `Preset "${preset.name}" has been deleted.`,
      });
    }
  };

  const handleEditPreset = (preset: PropPreset, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingPreset(preset);
    setPropsDialogOpen(true);
  };

  const getDeviceIcon = () => {
    switch (playground.deviceType) {
      case "mobile":
        return <Smartphone className="size-3" />;
      case "tablet":
        return <Tablet className="size-3" />;
      default:
        return <Monitor className="size-3" />;
    }
  };

  return (
    <div className="flex items-center gap-2">
      {/* Display mode buttons */}
      {!isFullscreen && !isPip && (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="debugger-fullscreen-button"
                variant="outline"
                size="sm"
                className="bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm shadow-sm hover:bg-white dark:hover:bg-zinc-900"
                onClick={() => onDisplayModeChange("fullscreen")}
              >
                <Maximize2 className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Enter fullscreen mode</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="debugger-pip-button"
                variant="outline"
                size="sm"
                className="bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm shadow-sm hover:bg-white dark:hover:bg-zinc-900"
                onClick={() => onDisplayModeChange("pip")}
              >
                <PictureInPicture className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Picture-in-picture</TooltipContent>
          </Tooltip>
        </>
      )}

      {/* Device Emulation */}
      <Dialog open={deviceDialogOpen} onOpenChange={setDeviceDialogOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>
              <Button
                data-testid="debugger-device-button"
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm shadow-sm hover:bg-white dark:hover:bg-zinc-900"
              >
                {getDeviceIcon()}
              </Button>
            </DialogTrigger>
          </TooltipTrigger>
          <TooltipContent>Device: {playground.deviceType}</TooltipContent>
        </Tooltip>
        <DialogContent
          className="sm:max-w-[300px]"
          data-testid="debugger-device-dialog"
        >
          <DialogHeader>
            <DialogTitle>Device Type</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {[
              { value: "desktop", label: "Desktop", icon: Monitor },
              { value: "mobile", label: "Mobile", icon: Smartphone },
              { value: "tablet", label: "Tablet", icon: Tablet },
            ].map((device) => {
              const Icon = device.icon;
              return (
                <Button
                  key={device.value}
                  data-testid={`debugger-device-option-${device.value}`}
                  variant={
                    playground.deviceType === device.value
                      ? "default"
                      : "outline"
                  }
                  className="w-full justify-start"
                  onClick={() => {
                    updatePlaygroundSettings({
                      deviceType: device.value as any,
                    });
                    // Update Apps SDK userAgent.device.type
                    if (isAppsSdk && onUpdateGlobals) {
                      onUpdateGlobals({
                        userAgent: {
                          device: { type: device.value },
                          capabilities: playground.capabilities,
                        },
                      });
                    }
                    setDeviceDialogOpen(false);
                  }}
                >
                  <Icon className="size-4 mr-2" />
                  {device.label}
                </Button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      {/* Locale */}
      <Dialog open={localeDialogOpen} onOpenChange={setLocaleDialogOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>
              <Button
                data-testid="debugger-locale-button"
                variant="outline"
                size="sm"
                className="h-8 min-w-[50px] px-2 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm shadow-sm hover:bg-white dark:hover:bg-zinc-900"
              >
                <span className="text-xs font-mono">{playground.locale}</span>
              </Button>
            </DialogTrigger>
          </TooltipTrigger>
          <TooltipContent>Locale</TooltipContent>
        </Tooltip>
        <DialogContent
          className="sm:max-w-[400px]"
          data-testid="debugger-locale-dialog"
        >
          <DialogHeader>
            <DialogTitle>Select Locale</DialogTitle>
          </DialogHeader>
          <Command>
            <CommandInput
              placeholder="Search locales..."
              data-testid="debugger-locale-search"
            />
            <CommandList>
              <CommandEmpty>No locale found.</CommandEmpty>
              <CommandGroup>
                {LOCALE_OPTIONS.map((locale) => (
                  <CommandItem
                    key={locale.value}
                    value={locale.value}
                    data-testid={`debugger-locale-option-${locale.value}`}
                    onSelect={() => {
                      updatePlaygroundSettings({ locale: locale.value });
                      // Update Apps SDK locale
                      if (isAppsSdk && onUpdateGlobals) {
                        onUpdateGlobals({ locale: locale.value });
                      }
                      setLocaleDialogOpen(false);
                    }}
                  >
                    {locale.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>

      {/* Timezone - only for MCP Apps (not supported by Apps SDK) */}
      {!isAppsSdk && (
        <Dialog open={timezoneDialogOpen} onOpenChange={setTimezoneDialogOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DialogTrigger asChild>
                <Button
                  data-testid="debugger-timezone-button"
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm shadow-sm hover:bg-white dark:hover:bg-zinc-900"
                >
                  <Clock className="size-3.5" />
                </Button>
              </DialogTrigger>
            </TooltipTrigger>
            <TooltipContent>Timezone: {playground.timeZone}</TooltipContent>
          </Tooltip>
          <DialogContent
            className="sm:max-w-[400px]"
            data-testid="debugger-timezone-dialog"
          >
            <DialogHeader>
              <DialogTitle>Select Timezone</DialogTitle>
            </DialogHeader>
            <Command>
              <CommandInput
                placeholder="Search timezones..."
                data-testid="debugger-timezone-search"
              />
              <CommandList>
                <CommandEmpty>No timezone found.</CommandEmpty>
                <CommandGroup>
                  {TIMEZONE_OPTIONS.map((tz) => (
                    <CommandItem
                      key={tz.value}
                      value={tz.value}
                      data-testid={`debugger-timezone-option-${tz.value.replace(/\//g, "-")}`}
                      onSelect={() => {
                        updatePlaygroundSettings({ timeZone: tz.value });
                        setTimezoneDialogOpen(false);
                      }}
                    >
                      {tz.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </DialogContent>
        </Dialog>
      )}

      {/* CSP Mode — shown for both MCP Apps and Apps SDK */}
      <Dialog open={cspDialogOpen} onOpenChange={setCspDialogOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>
              <Button
                data-testid="debugger-csp-button"
                variant="outline"
                size="sm"
                className="relative h-8 w-8 p-0 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm shadow-sm hover:bg-white dark:hover:bg-zinc-900"
              >
                {playground.cspMode === "permissive" ? (
                  <ShieldOff className="size-3.5" />
                ) : (
                  <ShieldCheck className="size-3.5" />
                )}
                {cspViolations.length > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-0.5 text-[9px] font-bold text-white leading-none">
                    {cspViolations.length > 99 ? "99+" : cspViolations.length}
                  </span>
                )}
              </Button>
            </DialogTrigger>
          </TooltipTrigger>
          <TooltipContent>
            CSP:{" "}
            {playground.cspMode === "permissive" ? "Permissive" : "Declared"}
            {cspViolations.length > 0 && ` · ${cspViolations.length} blocked`}
          </TooltipContent>
        </Tooltip>
        <DialogContent
          className="sm:max-w-[520px] max-h-[85vh] overflow-y-auto"
          data-testid="debugger-csp-dialog"
        >
          <DialogHeader>
            <DialogTitle>CSP Mode</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Button
              data-testid="debugger-csp-option-permissive"
              variant={
                playground.cspMode === "permissive" ? "default" : "outline"
              }
              className="w-full justify-start"
              onClick={() => {
                updatePlaygroundSettings({ cspMode: "permissive" });
                setCspDialogOpen(false);
              }}
            >
              <ShieldOff className="size-4 mr-2" />
              <div className="flex flex-col items-start">
                <span>Permissive</span>
              </div>
            </Button>
            <Button
              data-testid="debugger-csp-option-widget-declared"
              variant={
                playground.cspMode === "widget-declared" ? "default" : "outline"
              }
              className="w-full justify-start"
              onClick={() => {
                updatePlaygroundSettings({ cspMode: "widget-declared" });
                setCspDialogOpen(false);
              }}
            >
              <ShieldCheck className="size-4 mr-2" />
              <div className="flex flex-col items-start">
                <span>Widget-Declared</span>
              </div>
            </Button>
          </div>

          {/* Current declared CSP */}
          <div className="mt-3 border border-zinc-200 dark:border-zinc-700 rounded-md overflow-hidden">
            <button
              type="button"
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm font-medium bg-zinc-50 dark:bg-zinc-900/50 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors"
              onClick={() => setCspDeclaredExpanded((v) => !v)}
            >
              {cspDeclaredExpanded ? (
                <ChevronDown className="size-3.5 shrink-0" />
              ) : (
                <ChevronRight className="size-3.5 shrink-0" />
              )}
              Current declared CSP
            </button>
            {cspDeclaredExpanded && (
              <div className="px-3 pb-3 pt-0 space-y-1.5 text-xs">
                {declaredCsp ? (
                  <>
                    <div>
                      <span className="font-mono text-zinc-500 dark:text-zinc-400">
                        connectDomains:
                      </span>{" "}
                      {declaredCsp.connectDomains?.length
                        ? JSON.stringify(declaredCsp.connectDomains)
                        : "Not declared"}
                    </div>
                    <div>
                      <span className="font-mono text-zinc-500 dark:text-zinc-400">
                        resourceDomains:
                      </span>{" "}
                      {declaredCsp.resourceDomains?.length
                        ? JSON.stringify(declaredCsp.resourceDomains)
                        : "Not declared"}
                    </div>
                    <div>
                      <span className="font-mono text-zinc-500 dark:text-zinc-400">
                        frameDomains:
                      </span>{" "}
                      {declaredCsp.frameDomains?.length
                        ? JSON.stringify(declaredCsp.frameDomains)
                        : "Not declared"}
                    </div>
                    <div>
                      <span className="font-mono text-zinc-500 dark:text-zinc-400">
                        baseUriDomains:
                      </span>{" "}
                      {declaredCsp.baseUriDomains?.length
                        ? JSON.stringify(declaredCsp.baseUriDomains)
                        : "Not declared"}
                    </div>
                  </>
                ) : (
                  <span className="text-zinc-500 dark:text-zinc-400">
                    {playground.cspMode === "permissive"
                      ? "Widget-declared (would apply in Widget-Declared mode)"
                      : "No CSP declared"}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Policy string (originalPolicy / effectivePolicy) */}
          <div className="mt-3 border border-zinc-200 dark:border-zinc-700 rounded-md overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-3 py-2 bg-zinc-50 dark:bg-zinc-900/50 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors">
              <button
                type="button"
                className="flex-1 flex items-center gap-2 text-left text-sm font-medium min-w-0"
                onClick={() => setCspPolicyExpanded((v) => !v)}
              >
                {cspPolicyExpanded ? (
                  <ChevronDown className="size-3.5 shrink-0" />
                ) : (
                  <ChevronRight className="size-3.5 shrink-0" />
                )}
                originalPolicy
              </button>
              {effectivePolicy && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigator.clipboard.writeText(effectivePolicy);
                        toast.success("Policy copied to clipboard");
                      }}
                      aria-label="Copy policy"
                    >
                      <Copy className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Copy policy</TooltipContent>
                </Tooltip>
              )}
            </div>
            {cspPolicyExpanded && (
              <div className="px-3 pb-3 pt-0">
                {effectivePolicy ? (
                  <pre className="text-[11px] font-mono text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap break-all bg-zinc-50 dark:bg-zinc-900 p-2 rounded border border-zinc-100 dark:border-zinc-800">
                    {effectivePolicy}
                  </pre>
                ) : (
                  <span className="text-zinc-500 dark:text-zinc-400 text-xs">
                    No policy data yet (load widget in Widget-Declared mode)
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Prompt for Agents - only when there are blocked requests */}
          {cspViolations.length > -1 && (
            <div className="mt-3 border border-amber-200 dark:border-amber-800 rounded-md overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors">
                <button
                  type="button"
                  className="flex-1 flex items-center gap-2 text-left text-sm font-medium min-w-0 text-amber-800 dark:text-amber-200"
                  onClick={() => setCspSuggestedExpanded((v) => !v)}
                >
                  {cspSuggestedExpanded ? (
                    <ChevronDown className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                  ) : (
                    <ChevronRight className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                  )}
                  Prompt for Agents
                </button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 shrink-0 text-amber-600 dark:text-amber-400 hover:bg-amber-200/50 dark:hover:bg-amber-800/30"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigator.clipboard.writeText(agentPrompt);
                        toast.success("Prompt copied to clipboard");
                      }}
                      aria-label="Copy prompt for agents"
                    >
                      <Copy className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Copy prompt for agents</TooltipContent>
                </Tooltip>
              </div>
              {cspSuggestedExpanded && (
                <div className="px-3 pb-3 pt-0">
                  <pre
                    className="text-[11px] font-mono text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap bg-zinc-50 dark:bg-zinc-900 p-2 rounded border border-zinc-100 dark:border-zinc-800 overflow-x-auto max-h-48 overflow-y-auto"
                    data-testid="debugger-csp-prompt-for-agents"
                  >
                    {agentPrompt}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* CSP Violations panel */}
          {cspViolations.length > 0 && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide">
                  {cspViolations.length} blocked request
                  {cspViolations.length !== 1 ? "s" : ""}
                </span>
                <button
                  className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 underline"
                  onClick={() => clearCspViolations(toolCallId)}
                >
                  Clear
                </button>
              </div>
              <div className="max-h-56 overflow-y-auto space-y-1 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 p-2">
                {cspViolations.map((v, i) => (
                  <div
                    key={i}
                    className="flex flex-col gap-0.5 py-1 border-b border-zinc-100 dark:border-zinc-800 last:border-0"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="shrink-0 rounded bg-red-100 dark:bg-red-900/40 px-1 py-0.5 text-[10px] font-mono font-semibold text-red-700 dark:text-red-300">
                        {v.effectiveDirective || v.directive}
                      </span>
                    </div>
                    <span className="text-[11px] font-mono text-zinc-600 dark:text-zinc-400 break-all leading-snug">
                      {v.blockedUri || "(inline)"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Capabilities - Touch */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            data-testid="debugger-touch-button"
            variant="outline"
            size="sm"
            className={`h-8 w-8 p-0 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm shadow-sm hover:bg-white dark:hover:bg-zinc-900 ${
              playground.capabilities.touch
                ? "border-blue-500 dark:border-blue-400"
                : ""
            }`}
            onClick={() => {
              const newCapabilities = {
                ...playground.capabilities,
                touch: !playground.capabilities.touch,
              };
              updatePlaygroundSettings({
                capabilities: newCapabilities,
              });
              // Update Apps SDK userAgent.capabilities
              if (isAppsSdk && onUpdateGlobals) {
                onUpdateGlobals({
                  userAgent: {
                    device: { type: playground.deviceType },
                    capabilities: newCapabilities,
                  },
                });
              }
            }}
          >
            <Pointer
              className={`size-3.5 ${
                playground.capabilities.touch
                  ? "text-blue-600 dark:text-blue-400"
                  : ""
              }`}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Touch: {playground.capabilities.touch ? "Enabled" : "Disabled"}
        </TooltipContent>
      </Tooltip>

      {/* Capabilities - Hover */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            data-testid="debugger-hover-button"
            variant="outline"
            size="sm"
            className={`h-8 w-8 p-0 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm shadow-sm hover:bg-white dark:hover:bg-zinc-900 ${
              playground.capabilities.hover
                ? "border-blue-500 dark:border-blue-400"
                : ""
            }`}
            onClick={() => {
              const newCapabilities = {
                ...playground.capabilities,
                hover: !playground.capabilities.hover,
              };
              updatePlaygroundSettings({
                capabilities: newCapabilities,
              });
              // Update Apps SDK userAgent.capabilities
              if (isAppsSdk && onUpdateGlobals) {
                onUpdateGlobals({
                  userAgent: {
                    device: { type: playground.deviceType },
                    capabilities: newCapabilities,
                  },
                });
              }
            }}
          >
            <MousePointer2
              className={`size-3.5 ${
                playground.capabilities.hover
                  ? "text-blue-600 dark:text-blue-400"
                  : ""
              }`}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Hover: {playground.capabilities.hover ? "Enabled" : "Disabled"}
        </TooltipContent>
      </Tooltip>

      {/* Safe Area */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            data-testid="debugger-safe-area-button"
            variant="outline"
            size="sm"
            className="h-8 w-8 p-0 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm shadow-sm hover:bg-white dark:hover:bg-zinc-900"
          >
            <SquareDashedMousePointer className="size-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-64 p-3"
          data-testid="debugger-safe-area-dialog"
        >
          <div className="space-y-2">
            <label className="text-xs font-medium">Safe Area Insets</label>
            <SafeAreaInsetsEditor
              value={playground.safeAreaInsets}
              onChange={(insets) => {
                updatePlaygroundSettings({ safeAreaInsets: insets });
                // Update Apps SDK safeArea
                if (isAppsSdk && onUpdateGlobals) {
                  onUpdateGlobals({ safeArea: { insets } });
                }
              }}
            />
          </div>
        </PopoverContent>
      </Popover>

      {/* Props Button — JSON viewer in tool context, preset picker in resource context */}
      {propsContext === "tool" ? (
        <Dialog>
          <Tooltip>
            <TooltipTrigger asChild>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm shadow-sm hover:bg-white dark:hover:bg-zinc-900"
                  data-testid="debugger-props-button"
                >
                  <Braces className="size-3.5" />
                </Button>
              </DialogTrigger>
            </TooltipTrigger>
            <TooltipContent>View Tool Props</TooltipContent>
          </Tooltip>
          <DialogContent
            className="sm:max-w-[600px]"
            data-testid="debugger-props-dialog"
          >
            <DialogHeader>
              <DialogTitle>Tool Props</DialogTitle>
            </DialogHeader>
            <div className="overflow-auto max-h-[60vh] rounded-md bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 p-3">
              <JSONDisplay data={toolInput ?? {}} filename="tool-props.json" />
            </div>
          </DialogContent>
        </Dialog>
      ) : (
        <Popover open={propsPopoverOpen} onOpenChange={setPropsPopoverOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={`h-8 w-8 p-0 backdrop-blur-sm shadow-sm ${
                    missingProps
                      ? "bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/50 animate-pulse"
                      : "bg-white/90 dark:bg-zinc-900/90 hover:bg-white dark:hover:bg-zinc-900"
                  }`}
                  data-testid="debugger-props-button"
                >
                  <Braces
                    className={`size-3.5 ${missingProps ? "text-amber-500" : ""}`}
                  />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>
              Props:{" "}
              {selectValue === NO_PROPS_VALUE
                ? "No Props"
                : selectValue === TOOL_PROPS_VALUE
                  ? "Tool Props"
                  : presets.find((p) => p.id === selectValue)?.name || "Custom"}
            </TooltipContent>
          </Tooltip>
          <PopoverContent
            className="w-64 p-2"
            data-testid="debugger-props-popover"
          >
            {missingProps && (
              <div className="mb-2 rounded-md border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/30 px-3 py-2">
                <p className="text-xs font-medium text-amber-700 dark:text-amber-300 mb-0.5">
                  Props required to render this widget:
                </p>
                <p className="text-xs font-mono text-amber-600 dark:text-amber-400">
                  {requiredProps!.join(", ")}
                </p>
                <p className="text-xs text-amber-500 dark:text-amber-400 mt-1">
                  Create a preset below to set them.
                </p>
              </div>
            )}
            <div className="space-y-1">
              <Button
                variant={selectValue === NO_PROPS_VALUE ? "secondary" : "ghost"}
                size="sm"
                className="w-full justify-start"
                onClick={() => handleValueChange(NO_PROPS_VALUE)}
                data-testid="debugger-props-no-props"
              >
                No Props
              </Button>

              {presets.map((preset) => (
                <div
                  key={preset.id}
                  className="relative group flex items-center"
                >
                  <Button
                    variant={selectValue === preset.id ? "secondary" : "ghost"}
                    size="sm"
                    className="w-full justify-start pr-14"
                    onClick={() => handleValueChange(preset.id)}
                    data-testid={`debugger-props-preset-${preset.id}`}
                  >
                    {preset.name}
                  </Button>
                  <div className="absolute right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={(e) => handleEditPreset(preset, e)}
                      data-testid={`debugger-props-edit-${preset.id}`}
                    >
                      <Settings className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={(e) => handleDeletePreset(preset.id, e)}
                      data-testid={`debugger-props-delete-${preset.id}`}
                    >
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}

              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start text-primary"
                onClick={() => handleValueChange(CREATE_PRESET_VALUE)}
                data-testid="debugger-props-create-preset"
              >
                + Create Preset...
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )}

      {/* Console - uses IframeConsole drawer like Apps SDK */}
      <IframeConsole iframeId={toolCallId} enabled={true} />

      {/* Props Config Dialog */}
      {resource && (
        <PropsConfigDialog
          open={propsDialogOpen}
          onOpenChange={setPropsDialogOpen}
          onSave={handleSavePreset}
          existingPresets={presets}
          resource={resource}
          resourceAnnotations={resourceAnnotations}
          llmConfig={llmConfig || null}
          editingPreset={editingPreset}
        />
      )}
    </div>
  );
}
