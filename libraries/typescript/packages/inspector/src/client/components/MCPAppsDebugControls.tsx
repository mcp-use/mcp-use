import type { Resource } from "@mcp-use/client/react";
import {
  Braces,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Maximize2,
  Monitor,
  Moon,
  MousePointer2,
  PictureInPicture,
  Pointer,
  Settings,
  ShieldCheck,
  ShieldOff,
  Smartphone,
  SquareDashedMousePointer,
  Sun,
  Tablet,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { LOCALE_OPTIONS, TIMEZONE_OPTIONS } from "../constants/debug-options";
import { useWidgetDebug } from "../context/WidgetDebugContext";
import { useResourceProps, type PropPreset } from "../hooks/useResourceProps";
import type { LLMConfig } from "./chat/types";
import { copyToClipboard } from "@/client/utils/browser";
import { useTheme } from "@/client/context/ThemeContext";
import { IframeConsole } from "./IframeConsole";
import { PropsConfigDialog } from "./resources/PropsConfigDialog";
import { JSONDisplay } from "./shared/JSONDisplay";
import { SafeAreaInsetsEditor } from "./ui-playground/shared/SafeAreaInsetsEditor";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Input } from "./ui/input";
import { MenuItem } from "./ui/menu-item";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogJsonSection,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import {
  computeSuggestedFix,
  buildAgentCspPrompt,
} from "@/client/mcp-apps/debug/csp-suggestions";
import {
  diagnoseCsp,
  diffCspPolicies,
  getEffectiveCspPolicy,
  getRequestedCspPolicy,
} from "@/client/mcp-apps/csp";
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
}

const NO_PROPS_VALUE = "__no_props__";
const TOOL_PROPS_VALUE = "__tool_props__";
const CREATE_PRESET_VALUE = "__create_preset__";

const DEVICE_OPTIONS = [
  { value: "desktop", label: "Desktop", icon: Monitor },
  { value: "mobile", label: "Mobile", icon: Smartphone },
  { value: "tablet", label: "Tablet", icon: Tablet },
] as const;

type PickerOption = { value: string; label: string };

function DebuggerSearchableDropdown({
  options,
  value,
  onValueChange,
  placeholder,
  contentTestId,
  searchTestId,
  optionTestId,
  trigger,
}: {
  options: readonly PickerOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  contentTestId: string;
  searchTestId: string;
  optionTestId: (value: string) => string;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const id = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [...options];
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(q) ||
        option.value.toLowerCase().includes(q)
    );
  }, [options, query]);

  const checkedIndex = filtered.findIndex((option) => option.value === value);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      {trigger}
      <DropdownMenuContent
        data-testid={contentTestId}
        checkedIndex={checkedIndex >= 0 ? checkedIndex : undefined}
        className="w-80 overflow-hidden"
      >
        <div
          className="border-b border-border p-2"
          onKeyDown={(event) => event.stopPropagation()}
        >
          <Input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={placeholder}
            data-testid={searchTestId}
            className="h-8"
          />
        </div>
        <div className="max-h-64 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-3 py-4 text-xs text-muted-foreground">
              No results found.
            </p>
          ) : (
            filtered.map((option, index) => (
              <MenuItem
                key={option.value}
                index={index}
                label={option.label}
                checked={value === option.value}
                data-testid={optionTestId(option.value)}
                onSelect={() => {
                  onValueChange(option.value);
                  setOpen(false);
                }}
              />
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
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
}: MCPAppsDebugControlsProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const { playground, updatePlaygroundSettings, widgets, clearCspViolations } =
    useWidgetDebug();
  const widget = widgets.get(toolCallId);
  const cspViolations = widget?.cspViolations ?? [];
  const declaredCsp = widget?.declaredCsp;
  const effectivePolicy = widget?.effectivePolicy;
  const suggestedFix =
    cspViolations.length > 0
      ? computeSuggestedFix(cspViolations, declaredCsp)
      : null;
  const agentPrompt =
    cspViolations.length > 0
      ? buildAgentCspPrompt(
          declaredCsp,
          effectivePolicy,
          cspViolations,
          suggestedFix
        )
      : "";
  const isFullscreen = displayMode === "fullscreen";
  const isPip = displayMode === "pip";

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
  const [cspDialogOpen, setCspDialogOpen] = useState(false);
  const [cspTab, setCspTab] = useState<"mode" | "diff" | "findings">("mode");
  const [cspSuggestedExpanded, setCspSuggestedExpanded] = useState(true);

  const requestedPolicy = useMemo(
    () => getRequestedCspPolicy(declaredCsp),
    [declaredCsp]
  );
  const parsedEffectivePolicy = useMemo(
    () => getEffectiveCspPolicy(effectivePolicy),
    [effectivePolicy]
  );
  const policyDiff = useMemo(
    () => diffCspPolicies(requestedPolicy, parsedEffectivePolicy),
    [requestedPolicy, parsedEffectivePolicy]
  );
  const cspFindings = useMemo(
    () =>
      diagnoseCsp({
        mode: playground.cspMode,
        declared: declaredCsp,
        effectivePolicy,
        violations: cspViolations,
      }),
    [playground.cspMode, declaredCsp, effectivePolicy, cspViolations]
  );

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
      onPropsChange(null);
    } else if (activePresetId && selectValue === activePresetId) {
      const props = getActiveProps();
      if (props) onPropsChange(props);
    }
  }, [
    selectValue,
    activePresetId,
    toolInput,
    getActiveProps,
    onPropsChange,
    presets,
  ]);

  const handleValueChange = (value: string) => {
    if (value === CREATE_PRESET_VALUE) {
      setEditingPreset(null);
      setPropsDialogOpen(true);
      return;
    }

    if (value === NO_PROPS_VALUE || value === TOOL_PROPS_VALUE) {
      setActivePreset(null);
      setSelectValue(value);
      onPropsChange?.(null);
    } else {
      setActivePreset(value);
      setSelectValue(value);
      const preset = presets.find((p) => p.id === value);
      onPropsChange?.(preset?.props ?? null);
    }
  };

  const handleSavePreset = (preset: PropPreset) => {
    savePreset(preset);
    setActivePreset(preset.id);
    setSelectValue(preset.id);
    // Apply immediately — getActiveProps() can lag savePreset's state update.
    onPropsChange?.(preset.props);
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

  const deviceCheckedIndex = DEVICE_OPTIONS.findIndex(
    (device) => device.value === playground.deviceType
  );

  return (
    <div className="flex items-center gap-2">
      {/* Display mode buttons */}
      {!isFullscreen && !isPip && (
        <>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  data-testid="debugger-fullscreen-button"
                  variant="outline"
                  size="sm"
                  className="bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm shadow-sm hover:bg-white dark:hover:bg-zinc-900"
                  onClick={() => onDisplayModeChange("fullscreen")}
                >
                  <Maximize2 className="size-4" />
                </Button>
              }
              nativeButton
            />
            <TooltipContent>Enter fullscreen mode</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  data-testid="debugger-pip-button"
                  variant="outline"
                  size="sm"
                  className="bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm shadow-sm hover:bg-white dark:hover:bg-zinc-900"
                  onClick={() => onDisplayModeChange("pip")}
                >
                  <PictureInPicture className="size-4" />
                </Button>
              }
              nativeButton
            />
            <TooltipContent>Picture-in-picture</TooltipContent>
          </Tooltip>
        </>
      )}

      {/* Device Emulation */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger
            render={
              <DropdownMenuTrigger
                render={
                  <Button
                    data-testid="debugger-device-button"
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm shadow-sm hover:bg-white dark:hover:bg-zinc-900"
                  >
                    {getDeviceIcon()}
                  </Button>
                }
                nativeButton
              />
            }
            nativeButton
          />
          <TooltipContent>Device: {playground.deviceType}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          data-testid="debugger-device-dialog"
          checkedIndex={
            deviceCheckedIndex >= 0 ? deviceCheckedIndex : undefined
          }
          className="w-56"
        >
          {DEVICE_OPTIONS.map((device, index) => (
            <MenuItem
              key={device.value}
              index={index}
              icon={device.icon}
              label={device.label}
              checked={playground.deviceType === device.value}
              data-testid={`debugger-device-option-${device.value}`}
              onSelect={() =>
                updatePlaygroundSettings({
                  deviceType:
                    device.value as (typeof DEVICE_OPTIONS)[number]["value"],
                })
              }
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Theme Toggle */}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              data-testid="debugger-theme-button"
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm shadow-sm hover:bg-white dark:hover:bg-zinc-900"
              onClick={() => {
                const newTheme = resolvedTheme === "dark" ? "light" : "dark";
                setTheme(newTheme);
              }}
            >
              {resolvedTheme === "dark" ? (
                <Moon className="size-3.5" />
              ) : (
                <Sun className="size-3.5" />
              )}
            </Button>
          }
          nativeButton
        />
        <TooltipContent>
          Theme: {resolvedTheme === "dark" ? "Dark" : "Light"}
        </TooltipContent>
      </Tooltip>

      {/* Locale */}
      <DebuggerSearchableDropdown
        options={LOCALE_OPTIONS}
        value={playground.locale}
        onValueChange={(locale) => updatePlaygroundSettings({ locale })}
        placeholder="Search locales..."
        contentTestId="debugger-locale-dialog"
        searchTestId="debugger-locale-search"
        optionTestId={(value) => `debugger-locale-option-${value}`}
        trigger={
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  render={
                    <Button
                      data-testid="debugger-locale-button"
                      variant="outline"
                      size="sm"
                      className="h-8 min-w-[50px] px-2 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm shadow-sm hover:bg-white dark:hover:bg-zinc-900"
                    >
                      <span className="text-xs font-mono">
                        {playground.locale}
                      </span>
                    </Button>
                  }
                  nativeButton
                />
              }
              nativeButton
            />
            <TooltipContent>Locale</TooltipContent>
          </Tooltip>
        }
      />

      {/* Timezone */}
      <DebuggerSearchableDropdown
        options={TIMEZONE_OPTIONS}
        value={playground.timeZone}
        onValueChange={(timeZone) => updatePlaygroundSettings({ timeZone })}
        placeholder="Search timezones..."
        contentTestId="debugger-timezone-dialog"
        searchTestId="debugger-timezone-search"
        optionTestId={(value) =>
          `debugger-timezone-option-${value.replace(/\//g, "-")}`
        }
        trigger={
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  render={
                    <Button
                      data-testid="debugger-timezone-button"
                      variant="outline"
                      size="sm"
                      className="h-8 w-8 p-0 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm shadow-sm hover:bg-white dark:hover:bg-zinc-900"
                    >
                      <Clock className="size-3.5" />
                    </Button>
                  }
                  nativeButton
                />
              }
              nativeButton
            />
            <TooltipContent>Timezone: {playground.timeZone}</TooltipContent>
          </Tooltip>
        }
      />

      {/* CSP Mode */}
      <Dialog open={cspDialogOpen} onOpenChange={setCspDialogOpen}>
        <Tooltip>
          <TooltipTrigger
            render={
              <DialogTrigger
                render={
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
                      <span
                        className={`absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-0.5 text-[9px] font-bold text-white leading-none ${
                          playground.cspMode === "permissive"
                            ? "bg-yellow-500"
                            : "bg-red-500"
                        }`}
                      >
                        {cspViolations.length > 99
                          ? "99+"
                          : cspViolations.length}
                      </span>
                    )}
                  </Button>
                }
                nativeButton
              />
            }
            nativeButton
          />
          <TooltipContent>
            CSP:{" "}
            {playground.cspMode === "permissive" ? "Permissive" : "Declared"}
            {cspViolations.length > 0 &&
              ` · ${cspViolations.length} ${playground.cspMode === "permissive" ? "would be blocked" : "blocked"}`}
          </TooltipContent>
        </Tooltip>
        <DialogContent
          scrollable
          className="sm:max-w-[520px] max-h-[85vh]"
          data-testid="debugger-csp-dialog"
        >
          <DialogHeader>
            <DialogTitle>CSP Mode</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <div
              role="tablist"
              aria-label="CSP diagnostics"
              className="grid grid-cols-3 rounded-md border border-zinc-200 dark:border-zinc-700 p-1"
            >
              {[
                ["mode", "Mode"],
                ["diff", "Policy Diff"],
                ["findings", "Findings"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={cspTab === value}
                  onClick={() => setCspTab(value as typeof cspTab)}
                  className={`rounded px-2 py-1.5 text-xs font-medium ${
                    cspTab === value
                      ? "bg-zinc-100 dark:bg-zinc-800"
                      : "text-muted-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {cspTab === "mode" && (
              <div role="tabpanel" className="space-y-2">
                <Button
                  data-testid="debugger-csp-option-permissive"
                  variant={
                    playground.cspMode === "permissive" ? "default" : "outline"
                  }
                  className="w-full justify-start"
                  onClick={() =>
                    updatePlaygroundSettings({ cspMode: "permissive" })
                  }
                >
                  <ShieldOff className="size-4 mr-2" />
                  Permissive
                </Button>
                <Button
                  data-testid="debugger-csp-option-widget-declared"
                  variant={
                    playground.cspMode === "widget-declared"
                      ? "default"
                      : "outline"
                  }
                  className="w-full justify-start"
                  onClick={() =>
                    updatePlaygroundSettings({ cspMode: "widget-declared" })
                  }
                >
                  <ShieldCheck className="size-4 mr-2" />
                  Widget-Declared
                </Button>
                <p className="text-xs text-muted-foreground">
                  Permissive records would-be blocks; Widget-Declared enforces
                  the resource metadata policy.
                </p>
              </div>
            )}

            {cspTab === "diff" && (
              <div role="tabpanel" className="space-y-2">
                {policyDiff.length ? (
                  <div className="max-h-64 overflow-y-auto rounded border border-zinc-200 dark:border-zinc-700">
                    {policyDiff.map((diff) => (
                      <div
                        key={diff.directive}
                        className="border-b border-zinc-100 dark:border-zinc-800 p-2 text-xs last:border-0"
                      >
                        <div className="flex items-center justify-between">
                          <code>{diff.directive}</code>
                          <span className="text-[10px] uppercase text-muted-foreground">
                            {diff.status}
                          </span>
                        </div>
                        <div className="mt-1 font-mono text-[10px] text-muted-foreground break-all">
                          requested: {diff.requested.join(" ") || "—"}
                          <br />
                          effective: {diff.effective.join(" ") || "—"}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No requested or effective policy data yet.
                  </p>
                )}
                {effectivePolicy && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      try {
                        await copyToClipboard(effectivePolicy);
                        toast.success("Policy copied to clipboard");
                      } catch {
                        toast.error("Failed to copy");
                      }
                    }}
                  >
                    <Copy className="size-3.5 mr-2" />
                    Copy effective policy
                  </Button>
                )}
              </div>
            )}

            {cspTab === "findings" && (
              <div role="tabpanel" className="space-y-2">
                <div className="space-y-1.5">
                  {cspFindings.map((finding, index) => (
                    <div
                      key={`${finding.title}-${index}`}
                      className="rounded border border-zinc-200 dark:border-zinc-700 p-2"
                    >
                      <div className="text-xs font-medium">{finding.title}</div>
                      <div className="text-[11px] text-muted-foreground break-all">
                        {finding.detail}
                      </div>
                    </div>
                  ))}
                </div>
                {cspViolations.length > 0 && (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">
                        {cspViolations.length} observed request
                        {cspViolations.length === 1 ? "" : "s"}
                      </span>
                      <button
                        className="text-xs text-muted-foreground underline"
                        onClick={() => clearCspViolations(toolCallId)}
                      >
                        Clear
                      </button>
                    </div>
                    <div className="border border-amber-200 dark:border-amber-800 rounded-md overflow-hidden">
                      <div className="flex items-center justify-between bg-amber-50 dark:bg-amber-950/30 px-3 py-2">
                        <button
                          type="button"
                          className="flex items-center gap-2 text-xs font-medium text-amber-800 dark:text-amber-200"
                          onClick={() => setCspSuggestedExpanded((v) => !v)}
                        >
                          {cspSuggestedExpanded ? (
                            <ChevronDown className="size-3.5" />
                          ) : (
                            <ChevronRight className="size-3.5" />
                          )}
                          Prompt for Agents
                        </button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() => void copyToClipboard(agentPrompt)}
                          aria-label="Copy prompt for agents"
                        >
                          <Copy className="size-3.5" />
                        </Button>
                      </div>
                      {cspSuggestedExpanded && (
                        <pre
                          className="max-h-48 overflow-auto whitespace-pre-wrap p-2 text-[11px]"
                          data-testid="debugger-csp-prompt-for-agents"
                        >
                          {agentPrompt}
                        </pre>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>

      {/* Capabilities - Touch */}
      <Tooltip>
        <TooltipTrigger
          render={
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
          }
          nativeButton
        />
        <TooltipContent>
          Touch: {playground.capabilities.touch ? "Enabled" : "Disabled"}
        </TooltipContent>
      </Tooltip>

      {/* Capabilities - Hover */}
      <Tooltip>
        <TooltipTrigger
          render={
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
          }
          nativeButton
        />
        <TooltipContent>
          Hover: {playground.capabilities.hover ? "Enabled" : "Disabled"}
        </TooltipContent>
      </Tooltip>

      {/* Safe Area */}
      <Popover>
        <PopoverTrigger
          render={
            <Button
              data-testid="debugger-safe-area-button"
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm shadow-sm hover:bg-white dark:hover:bg-zinc-900"
            >
              <SquareDashedMousePointer className="size-3.5" />
            </Button>
          }
          nativeButton
        />
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
              }}
            />
          </div>
        </PopoverContent>
      </Popover>

      {/* Props Button — JSON viewer in tool context, preset picker in resource context */}
      {propsContext === "tool" ? (
        <Dialog>
          <Tooltip>
            <TooltipTrigger
              render={
                <DialogTrigger
                  render={
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 w-8 p-0 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm shadow-sm hover:bg-white dark:hover:bg-zinc-900"
                      data-testid="debugger-props-button"
                    >
                      <Braces className="size-3.5" />
                    </Button>
                  }
                  nativeButton
                />
              }
              nativeButton
            />
            <TooltipContent>View Tool Props</TooltipContent>
          </Tooltip>
          <DialogContent
            scrollable
            className="sm:max-w-[600px] max-h-[85vh]"
            data-testid="debugger-props-dialog"
          >
            <DialogHeader>
              <DialogTitle>Tool Props</DialogTitle>
            </DialogHeader>
            <DialogBody>
              <DialogJsonSection>
                <JSONDisplay
                  data={toolInput ?? {}}
                  filename="tool-props.json"
                />
              </DialogJsonSection>
            </DialogBody>
          </DialogContent>
        </Dialog>
      ) : (
        <Popover open={propsPopoverOpen} onOpenChange={setPropsPopoverOpen}>
          <Tooltip>
            <TooltipTrigger
              render={
                <PopoverTrigger
                  render={
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
                  }
                  nativeButton
                />
              }
              nativeButton
            />
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
