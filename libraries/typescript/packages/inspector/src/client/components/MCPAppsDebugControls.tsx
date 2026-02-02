import type { Resource } from "@modelcontextprotocol/sdk/types.js";
import {
  Braces,
  Clock,
  Maximize2,
  Monitor,
  MousePointer2,
  Pointer,
  PictureInPicture,
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
import { useWidgetDebug } from "../context/WidgetDebugContext";
import { useResourceProps, type PropPreset } from "../hooks/useResourceProps";
import type { LLMConfig } from "./chat/types";
import { IframeConsole } from "./IframeConsole";
import { PropsConfigDialog } from "./resources/PropsConfigDialog";
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
  protocol = "mcp-apps",
  onUpdateGlobals,
}: MCPAppsDebugControlsProps) {
  const { playground, updatePlaygroundSettings } = useWidgetDebug();
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
  const [editingPreset, setEditingPreset] = useState<PropPreset | null>(null);
  const [deviceDialogOpen, setDeviceDialogOpen] = useState(false);
  const [localeDialogOpen, setLocaleDialogOpen] = useState(false);
  const [timezoneDialogOpen, setTimezoneDialogOpen] = useState(false);
  const [cspDialogOpen, setCspDialogOpen] = useState(false);

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

  // Update select value when active preset changes
  useEffect(() => {
    if (activePresetId) {
      setSelectValue(activePresetId);
    } else if (
      selectValue !== NO_PROPS_VALUE &&
      selectValue !== TOOL_PROPS_VALUE
    ) {
      // If no active preset and not a special value, reset to default
      setSelectValue(getDefaultSelectValue());
    }
  }, [activePresetId, selectValue, getDefaultSelectValue]);

  // Notify parent of props changes
  useEffect(() => {
    if (!onPropsChange) return;

    if (selectValue === NO_PROPS_VALUE) {
      onPropsChange(null);
    } else if (selectValue === TOOL_PROPS_VALUE && toolInput) {
      // Convert toolInput to string props
      const stringProps: Record<string, string> = {};
      Object.entries(toolInput).forEach(([key, value]) => {
        stringProps[key] = String(value);
      });
      onPropsChange(stringProps);
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

      {/* CSP Mode - only for MCP Apps (rendering concern, not widget API) */}
      {!isAppsSdk && (
        <Dialog open={cspDialogOpen} onOpenChange={setCspDialogOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DialogTrigger asChild>
                <Button
                  data-testid="debugger-csp-button"
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm shadow-sm hover:bg-white dark:hover:bg-zinc-900"
                >
                  {playground.cspMode === "permissive" ? (
                    <ShieldOff className="size-3.5" />
                  ) : (
                    <ShieldCheck className="size-3.5" />
                  )}
                </Button>
              </DialogTrigger>
            </TooltipTrigger>
            <TooltipContent>
              CSP:{" "}
              {playground.cspMode === "permissive" ? "Permissive" : "Declared"}
            </TooltipContent>
          </Tooltip>
          <DialogContent
            className="sm:max-w-[300px]"
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
                  <span className="text-xs opacity-70">Development</span>
                </div>
              </Button>
              <Button
                data-testid="debugger-csp-option-widget-declared"
                variant={
                  playground.cspMode === "widget-declared"
                    ? "default"
                    : "outline"
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
                  <span className="text-xs opacity-70">Production</span>
                </div>
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

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

      {/* Props Selection */}
      <Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm shadow-sm hover:bg-white dark:hover:bg-zinc-900"
              >
                <Braces className="size-3.5" />
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
        <PopoverContent className="w-64 p-2">
          <div className="space-y-1">
            <Button
              variant={selectValue === NO_PROPS_VALUE ? "default" : "ghost"}
              size="sm"
              className="w-full justify-start"
              onClick={() => handleValueChange(NO_PROPS_VALUE)}
            >
              No Props
            </Button>

            {propsContext === "tool" && toolInput && (
              <Button
                variant={selectValue === TOOL_PROPS_VALUE ? "default" : "ghost"}
                size="sm"
                className="w-full justify-start"
                onClick={() => handleValueChange(TOOL_PROPS_VALUE)}
              >
                Props from Tool
              </Button>
            )}

            {presets.map((preset) => (
              <div key={preset.id} className="relative group flex items-center">
                <Button
                  variant={selectValue === preset.id ? "default" : "ghost"}
                  size="sm"
                  className="w-full justify-start pr-14"
                  onClick={() => handleValueChange(preset.id)}
                >
                  {preset.name}
                </Button>
                <div className="absolute right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={(e) => handleEditPreset(preset, e)}
                  >
                    <Settings className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={(e) => handleDeletePreset(preset.id, e)}
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
            >
              + Create Preset...
            </Button>
          </div>
        </PopoverContent>
      </Popover>

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
