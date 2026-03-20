/**
 * Hook for calculating device viewport dimensions
 */

import { useMemo } from "react";
import type { DeviceType } from "../context/WidgetDebugContext";
import { DEVICE_VIEWPORT_CONFIGS } from "../context/WidgetDebugContext";

export interface ViewportDimensions {
  maxWidth: number;
  maxHeight: number;
}

export interface CustomViewport {
  width: number;
  height: number;
}

/**
 * Calculate viewport dimensions based on device type
 */
export function useDeviceViewport(
  deviceType: DeviceType,
  customViewport: CustomViewport
): ViewportDimensions {
  return useMemo(() => {
    if (deviceType === "custom") {
      return {
        maxWidth: customViewport.width,
        maxHeight: customViewport.height,
      };
    }
    return {
      maxWidth: DEVICE_VIEWPORT_CONFIGS[deviceType].width,
      maxHeight: DEVICE_VIEWPORT_CONFIGS[deviceType].height,
    };
  }, [deviceType, customViewport]);
}
