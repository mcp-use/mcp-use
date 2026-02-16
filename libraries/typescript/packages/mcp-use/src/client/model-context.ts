/**
 * Guarded access to the WebMCP API (navigator.modelContext).
 * This feature is in beta: requires Chrome 146+ and the "Experimental Web Platform Features" flag.
 */

const MODEL_CONTEXT_WARN =
  "navigator.modelContext is not available. This feature requires Chrome 146+ and the Experimental Web Platform Features flag enabled (chrome://flags#enable-experimental-web-platform-features).";

declare global {
  interface Navigator {
    modelContext?: unknown;
  }
}

/**
 * Returns the WebMCP API (navigator.modelContext) if available.
 * In beta: requires Chrome 146+ and the Experimental Web Platform Features flag.
 * If not available, logs a console warning and returns undefined.
 */
export function getModelContext():
  | (typeof navigator)["modelContext"]
  | undefined {
  if (typeof navigator === "undefined") {
    return undefined;
  }
  const modelContext = (navigator as Navigator).modelContext;
  if (modelContext == null) {
    console.warn(MODEL_CONTEXT_WARN);
    return undefined;
  }
  return modelContext;
}

/**
 * Returns true if the WebMCP API (navigator.modelContext) is available.
 * Does not log a warning; use getModelContext() when you need the API and want the warning.
 */
export function isModelContextAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "modelContext" in navigator &&
    (navigator as Navigator).modelContext != null
  );
}
