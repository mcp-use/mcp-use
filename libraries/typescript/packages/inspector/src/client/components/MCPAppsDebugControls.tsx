import {
  Maximize2,
  PictureInPicture,
  Monitor,
  Smartphone,
  Tablet,
  ChevronDown,
} from "lucide-react";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { IframeConsole } from "./IframeConsole";
import { useWidgetDebug } from "../context/WidgetDebugContext";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

interface MCPAppsDebugControlsProps {
  displayMode: "inline" | "pip" | "fullscreen";
  onDisplayModeChange: (mode: "inline" | "pip" | "fullscreen") => void;
  toolCallId: string;
}

export function MCPAppsDebugControls({
  displayMode,
  onDisplayModeChange,
  toolCallId,
}: MCPAppsDebugControlsProps) {
  const { playground, updatePlaygroundSettings } = useWidgetDebug();
  const isFullscreen = displayMode === "fullscreen";
  const isPip = displayMode === "pip";

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
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm shadow-sm hover:bg-white dark:hover:bg-zinc-900 gap-1"
          >
            {getDeviceIcon()}
            <span className="text-xs">{playground.deviceType}</span>
            <ChevronDown className="size-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-2">
          <div className="space-y-2">
            <label className="text-xs font-medium">Device Type</label>
            <Select
              value={playground.deviceType}
              onValueChange={(value: any) =>
                updatePlaygroundSettings({ deviceType: value })
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="desktop">Desktop</SelectItem>
                <SelectItem value="mobile">Mobile</SelectItem>
                <SelectItem value="tablet">Tablet</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </PopoverContent>
      </Popover>

      {/* Locale */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm shadow-sm hover:bg-white dark:hover:bg-zinc-900"
          >
            <span className="text-xs">{playground.locale}</span>
            <ChevronDown className="size-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-48 p-2">
          <div className="space-y-2">
            <label className="text-xs font-medium">Locale</label>
            <Select
              value={playground.locale}
              onValueChange={(value) =>
                updatePlaygroundSettings({ locale: value })
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en-US">English (US)</SelectItem>
                <SelectItem value="en-GB">English (GB)</SelectItem>
                <SelectItem value="fr-FR">French</SelectItem>
                <SelectItem value="de-DE">German</SelectItem>
                <SelectItem value="ja-JP">Japanese</SelectItem>
                <SelectItem value="zh-CN">Chinese</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </PopoverContent>
      </Popover>

      {/* Timezone */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm shadow-sm hover:bg-white dark:hover:bg-zinc-900"
          >
            <span className="text-xs">{playground.timeZone}</span>
            <ChevronDown className="size-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-2">
          <div className="space-y-2">
            <label className="text-xs font-medium">Timezone</label>
            <Select
              value={playground.timeZone}
              onValueChange={(value) =>
                updatePlaygroundSettings({ timeZone: value })
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="America/New_York">New York</SelectItem>
                <SelectItem value="America/Los_Angeles">Los Angeles</SelectItem>
                <SelectItem value="Europe/London">London</SelectItem>
                <SelectItem value="Europe/Paris">Paris</SelectItem>
                <SelectItem value="Asia/Tokyo">Tokyo</SelectItem>
                <SelectItem value="UTC">UTC</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </PopoverContent>
      </Popover>

      {/* CSP Mode */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm shadow-sm hover:bg-white dark:hover:bg-zinc-900"
          >
            <span className="text-xs">
              CSP:{" "}
              {playground.cspMode === "permissive" ? "Permissive" : "Declared"}
            </span>
            <ChevronDown className="size-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-2">
          <div className="space-y-2">
            <label className="text-xs font-medium">CSP Mode</label>
            <Select
              value={playground.cspMode}
              onValueChange={(value: "permissive" | "widget-declared") =>
                updatePlaygroundSettings({ cspMode: value })
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="permissive">
                  <div className="flex flex-col items-start">
                    <span>Permissive</span>
                    <span className="text-xs text-zinc-500">Development</span>
                  </div>
                </SelectItem>
                <SelectItem value="widget-declared">
                  <div className="flex flex-col items-start">
                    <span>Widget-Declared</span>
                    <span className="text-xs text-zinc-500">Production</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </PopoverContent>
      </Popover>

      {/* Capabilities (Touch/Cursor) */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm shadow-sm hover:bg-white dark:hover:bg-zinc-900"
          >
            <span className="text-xs">
              {playground.capabilities.hasTouch ? "Touch" : "Cursor"}
            </span>
            <ChevronDown className="size-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3">
          <div className="space-y-3">
            <label className="text-xs font-medium">Capabilities</label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={playground.capabilities.hasTouch}
                  onChange={(e) =>
                    updatePlaygroundSettings({
                      capabilities: {
                        ...playground.capabilities,
                        hasTouch: e.target.checked,
                      },
                    })
                  }
                  className="rounded"
                />
                Touch Support
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={playground.capabilities.hasKeyboard}
                  onChange={(e) =>
                    updatePlaygroundSettings({
                      capabilities: {
                        ...playground.capabilities,
                        hasKeyboard: e.target.checked,
                      },
                    })
                  }
                  className="rounded"
                />
                Keyboard
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={playground.capabilities.canCopy}
                  onChange={(e) =>
                    updatePlaygroundSettings({
                      capabilities: {
                        ...playground.capabilities,
                        canCopy: e.target.checked,
                      },
                    })
                  }
                  className="rounded"
                />
                Copy Support
              </label>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {/* Safe Area */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm shadow-sm hover:bg-white dark:hover:bg-zinc-900"
          >
            <span className="text-xs">Safe Area</span>
            <ChevronDown className="size-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3">
          <div className="space-y-2">
            <label className="text-xs font-medium">Safe Area Insets</label>
            {(["top", "right", "bottom", "left"] as const).map((side) => (
              <div key={side} className="flex items-center gap-2">
                <label className="text-xs w-12">{side}</label>
                <input
                  type="number"
                  value={playground.safeAreaInsets[side]}
                  onChange={(e) =>
                    updatePlaygroundSettings({
                      safeAreaInsets: {
                        ...playground.safeAreaInsets,
                        [side]: parseInt(e.target.value) || 0,
                      },
                    })
                  }
                  className="flex-1 h-7 px-2 text-xs rounded border bg-background"
                  min="0"
                />
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* Console - uses IframeConsole drawer like Apps SDK */}
      <IframeConsole iframeId={toolCallId} enabled={true} />
    </div>
  );
}
