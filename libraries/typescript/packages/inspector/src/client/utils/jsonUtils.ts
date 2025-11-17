/**
 * Utility functions for handling large JSON objects in the inspector
 */

// Size threshold in bytes (100KB)
const LARGE_JSON_THRESHOLD = 100 * 1024;

// Preview length for large JSON (first 50KB)
const PREVIEW_LENGTH = 50 * 1024;

export interface LargeJSONInfo {
  isLarge: boolean;
  size: number;
  sizeFormatted: string;
  preview: string;
  full: string;
}

/**
 * Check if a JSON object is too large and get preview information
 */
export function analyzeJSON(data: any): LargeJSONInfo {
  const full = JSON.stringify(data, null, 2);
  const size = new Blob([full]).size;
  const isLarge = size > LARGE_JSON_THRESHOLD;

  // Get preview (first N characters)
  const preview = isLarge ? full.substring(0, PREVIEW_LENGTH) : full;

  // Format size
  const sizeFormatted = formatBytes(size);

  return {
    isLarge,
    size,
    sizeFormatted,
    preview,
    full,
  };
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

/**
 * Download JSON data as a file
 */
export function downloadJSON(data: any, filename?: string): void {
  try {
    const jsonString = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonString], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || `data-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Failed to download JSON:", error);
    throw error;
  }
}
