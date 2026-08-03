/**
 * Hook for calculating device viewport dimensions
 */

import { useMemo } from "react";
import type { DeviceType } from "../context/WidgetDebugContext";
import { DEVICE_VIEWPORT_CONFIGS } from "../context/WidgetDebugContext";

interface ViewportDimensions {
  maxWidth: number;
  maxHeight: number;
}

/**
 * Calculate viewport dimensions based on device type
 */
export function useDeviceViewport(deviceType: DeviceType): ViewportDimensions {
  return useMemo(
    () => ({
      maxWidth: DEVICE_VIEWPORT_CONFIGS[deviceType].width,
      maxHeight: DEVICE_VIEWPORT_CONFIGS[deviceType].height,
    }),
    [deviceType]
  );
}
