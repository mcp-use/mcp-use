/**
 * Device Emulation Controls
 *
 * Controls for testing widgets on different device types:
 * - Mobile, Tablet, Desktop, Custom
 * - Touch/hover capabilities
 * - Safe area insets
 */

import { useState } from "react";
import { Smartphone, Tablet, Monitor, Maximize2 } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  useWidgetDebug,
  DEVICE_VIEWPORT_CONFIGS,
  SAFE_AREA_PRESETS,
} from "../../context/WidgetDebugContext";

export function DeviceEmulationControls() {
  const { playground, updatePlaygroundSettings } = useWidgetDebug();
  const [showAdvanced, setShowAdvanced] = useState(false);

  const deviceButtons = [
    {
      type: "mobile" as const,
      icon: Smartphone,
      label: "Mobile",
    },
    {
      type: "tablet" as const,
      icon: Tablet,
      label: "Tablet",
    },
    {
      type: "desktop" as const,
      icon: Monitor,
      label: "Desktop",
    },
    {
      type: "custom" as const,
      icon: Maximize2,
      label: "Custom",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">Device Type</label>
        <div className="grid grid-cols-2 gap-2">
          {deviceButtons.map(({ type, icon: Icon, label }) => (
            <Button
              key={type}
              variant={playground.deviceType === type ? "default" : "outline"}
              size="sm"
              onClick={() => updatePlaygroundSettings({ deviceType: type })}
              className="w-full"
            >
              <Icon className="w-4 h-4 mr-2" />
              {label}
            </Button>
          ))}
        </div>
        <div className="text-xs text-zinc-500 dark:text-zinc-400 px-1">
          {playground.deviceType === "custom"
            ? `${playground.customViewport.width} × ${playground.customViewport.height}`
            : `${DEVICE_VIEWPORT_CONFIGS[playground.deviceType].width} × ${DEVICE_VIEWPORT_CONFIGS[playground.deviceType].height}`}
        </div>
      </div>

      {/* Custom Viewport */}
      {playground.deviceType === "custom" && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="width" className="text-xs">
                Width
              </Label>
              <Input
                id="width"
                type="number"
                value={playground.customViewport.width}
                onChange={(e) =>
                  updatePlaygroundSettings({
                    customViewport: {
                      ...playground.customViewport,
                      width: parseInt(e.target.value) || 0,
                    },
                  })
                }
                className="h-8"
              />
            </div>
            <div>
              <Label htmlFor="height" className="text-xs">
                Height
              </Label>
              <Input
                id="height"
                type="number"
                value={playground.customViewport.height}
                onChange={(e) =>
                  updatePlaygroundSettings({
                    customViewport: {
                      ...playground.customViewport,
                      height: parseInt(e.target.value) || 0,
                    },
                  })
                }
                className="h-8"
              />
            </div>
          </div>
        </div>
      )}

      {/* Capabilities */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Device Capabilities</label>
        <div className="space-y-2 px-1">
          <div className="flex items-center justify-between">
            <Label htmlFor="hover" className="text-sm font-normal">
              Hover support
            </Label>
            <Switch
              id="hover"
              checked={playground.capabilities.hover}
              onCheckedChange={(hover) =>
                updatePlaygroundSettings({
                  capabilities: { ...playground.capabilities, hover },
                })
              }
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="touch" className="text-sm font-normal">
              Touch support
            </Label>
            <Switch
              id="touch"
              checked={playground.capabilities.touch}
              onCheckedChange={(touch) =>
                updatePlaygroundSettings({
                  capabilities: { ...playground.capabilities, touch },
                })
              }
            />
          </div>
        </div>
      </div>

      {/* Safe Area Insets */}
      <div className="space-y-2">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-sm font-medium hover:underline"
        >
          {showAdvanced ? "▼" : "►"} Safe Area Insets
        </button>

        {showAdvanced && (
          <div className="space-y-3 px-1">
            <Select
              value={Object.keys(SAFE_AREA_PRESETS).find(
                (key) =>
                  JSON.stringify(
                    SAFE_AREA_PRESETS[key as keyof typeof SAFE_AREA_PRESETS]
                  ) ===
                  JSON.stringify({ ...playground.safeAreaInsets, name: "" })
              )}
              onValueChange={(key) => {
                const preset =
                  SAFE_AREA_PRESETS[key as keyof typeof SAFE_AREA_PRESETS];
                if (preset) {
                  updatePlaygroundSettings({
                    safeAreaInsets: {
                      top: preset.top,
                      right: preset.right,
                      bottom: preset.bottom,
                      left: preset.left,
                    },
                  });
                }
              }}
            >
              <SelectTrigger className="h-8">
                <SelectValue placeholder="Select preset..." />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(SAFE_AREA_PRESETS).map(([key, preset]) => (
                  <SelectItem key={key} value={key}>
                    {preset.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="grid grid-cols-2 gap-2">
              {(["top", "right", "bottom", "left"] as const).map((side) => (
                <div key={side}>
                  <Label htmlFor={side} className="text-xs capitalize">
                    {side}
                  </Label>
                  <Input
                    id={side}
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
                    className="h-8"
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
