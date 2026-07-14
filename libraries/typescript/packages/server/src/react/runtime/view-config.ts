import type { DisplayMode } from "../types/host-types.js";

/**
 * Immutable pre-render runtime configuration for a view module.
 *
 * Export as a named `viewConfig` alongside the default component. Values are
 * normalized and validated by `bootstrapView` before the guest `App` is
 * constructed. React presentation settings do not belong here — compose
 * {@link ThemeProvider} / {@link ViewControls} in the component tree instead.
 *
 * @example
 * ```tsx
 * import type { ViewConfig } from "@mcp-use/server/react";
 *
 * export const viewConfig = {
 *   autoResize: false,
 *   displayModes: ["inline", "fullscreen"],
 * } satisfies ViewConfig;
 *
 * export default function CanvasView() {
 *   return <Canvas />;
 * }
 * ```
 */
export interface ViewConfig {
  /**
   * Let ext-apps observe the document and report size changes.
   *
   * @defaultValue true
   */
  autoResize?: boolean;

  /**
   * Display modes this view can render correctly.
   *
   * Must contain "inline".
   *
   * @defaultValue ["inline", "fullscreen", "pip"]
   */
  displayModes?: readonly DisplayMode[];
}

/**
 * Fully-resolved {@link ViewConfig} with every field required.
 *
 * @internal
 */
export interface NormalizedViewConfig {
  /** Whether the guest `App` auto-measures and reports size changes. */
  autoResize: boolean;
  /** Display modes advertised to the host via App capabilities. */
  displayModes: readonly DisplayMode[];
}

const DEFAULT_DISPLAY_MODES: readonly DisplayMode[] = [
  "inline",
  "fullscreen",
  "pip",
];

const VALID_DISPLAY_MODES: ReadonlySet<string> = new Set<DisplayMode>([
  "inline",
  "fullscreen",
  "pip",
]);

/**
 * Normalize and validate an optional {@link ViewConfig}.
 *
 * @param config - Optional named export from a view module.
 * @returns A fully-resolved config with defaults applied.
 * @throws When `displayModes` is empty, contains duplicates, omits `"inline"`,
 *   or includes a value that is not a known {@link DisplayMode}.
 *
 * @internal
 */
export function normalizeViewConfig(
  config?: ViewConfig
): NormalizedViewConfig {
  const autoResize = config?.autoResize ?? true;

  if (config?.displayModes === undefined) {
    return { autoResize, displayModes: DEFAULT_DISPLAY_MODES };
  }

  const modes = config.displayModes;
  if (!Array.isArray(modes) || modes.length === 0) {
    throw new Error(
      'viewConfig.displayModes must be a non-empty array that includes "inline"'
    );
  }

  const seen = new Set<string>();
  const normalizedModes: DisplayMode[] = [];
  for (const mode of modes) {
    if (typeof mode !== "string" || !VALID_DISPLAY_MODES.has(mode)) {
      throw new Error(
        `viewConfig.displayModes contains invalid mode ${JSON.stringify(mode)}; expected "inline", "fullscreen", or "pip"`
      );
    }
    if (seen.has(mode)) {
      throw new Error(
        `viewConfig.displayModes contains duplicate mode "${mode}"`
      );
    }
    seen.add(mode);
    // Validated against VALID_DISPLAY_MODES above.
    normalizedModes.push(mode as DisplayMode);
  }

  if (!seen.has("inline")) {
    throw new Error('viewConfig.displayModes must include "inline"');
  }

  return {
    autoResize,
    displayModes: normalizedModes,
  };
}
