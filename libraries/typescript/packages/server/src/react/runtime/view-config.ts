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
 * import type { ViewConfig } from "mcp-use/react";
 *
 * export const viewConfig = {
 *   autoResize: false,
 *   displayModes: ["inline", "fullscreen"],
 *   preferredDisplayMode: "fullscreen",
 * } satisfies ViewConfig;
 *
 * export default function CanvasView() {
 *   return <Canvas />;
 * }
 * ```
 */
export interface ViewConfig {
  /**
   * Opt into native attachments through useModelContext. Uses the standard
   * context writer and assistant-only background projection instead of widget
   * modelContent persistence. Private UI state needs separate persistence.
   * Omit to preserve the existing widget-state transport and visible projection.
   */
  modelContext?: "attachments";
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

  /**
   * Hint to ChatGPT for the initial display mode, emitted on the UI resource.
   * Must belong to `displayModes`. ChatGPT may ignore this preference and
   * currently supports only "inline" and "fullscreen".
   */
  preferredDisplayMode?: "inline" | "fullscreen";
}

/**
 * {@link ViewConfig} with runtime defaults applied. The initial display
 * preference stays absent unless explicitly configured.
 *
 * @internal
 */
export interface NormalizedViewConfig {
  /** Explicit native-attachment migration; absent preserves compatibility. */
  modelContext?: "attachments";
  /** Whether the guest `App` auto-measures and reports size changes. */
  autoResize: boolean;
  /** Display modes advertised to the host via App capabilities. */
  displayModes: readonly DisplayMode[];
  /** Optional initial display preference emitted on the UI resource. */
  preferredDisplayMode?: "inline" | "fullscreen";
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
 *   or includes a value that is not a known {@link DisplayMode}, or when
 *   `preferredDisplayMode` is invalid or not among the supported modes.
 *
 * @internal
 */
export function normalizeViewConfig(config?: ViewConfig): NormalizedViewConfig {
  const autoResize = config?.autoResize ?? true;
  if (
    config?.modelContext !== undefined &&
    config.modelContext !== "attachments"
  ) {
    throw new Error(
      'viewConfig.modelContext must be "attachments" when supplied'
    );
  }

  const modes =
    config?.displayModes === undefined
      ? DEFAULT_DISPLAY_MODES
      : config.displayModes;
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

  const preferred = config?.preferredDisplayMode;
  if (
    preferred !== undefined &&
    preferred !== "inline" &&
    preferred !== "fullscreen"
  ) {
    throw new Error(
      'viewConfig.preferredDisplayMode must be "inline" or "fullscreen"'
    );
  }
  if (preferred !== undefined && !seen.has(preferred)) {
    throw new Error(
      "viewConfig.preferredDisplayMode must belong to displayModes"
    );
  }

  return {
    ...(config?.modelContext !== undefined && {
      modelContext: config.modelContext,
    }),
    ...(preferred !== undefined && { preferredDisplayMode: preferred }),
    autoResize,
    displayModes: normalizedModes,
  };
}
