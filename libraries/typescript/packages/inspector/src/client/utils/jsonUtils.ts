/**
 * Utility functions for handling large JSON objects in the inspector
 */

// Size threshold in bytes (100KB)
const LARGE_JSON_THRESHOLD = 100 * 1024;

// Maximum length for individual property values in preview (20KB)
const MAX_VALUE_LENGTH = 1024 * 20;

export interface LargeJSONInfo {
  isLarge: boolean;
  size: number;
  sizeFormatted: string;
  preview: string;
  full: string;
}

/**
 * Recursively truncate string values in an object/array while preserving structure
 */
function truncatePropertyValues(obj: any, maxLength: number): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === "string") {
    if (obj.length > maxLength) {
      return obj.substring(0, maxLength) + "... (truncated)";
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => truncatePropertyValues(item, maxLength));
  }

  if (typeof obj === "object") {
    const truncated: any = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        truncated[key] = truncatePropertyValues(obj[key], maxLength);
      }
    }
    return truncated;
  }

  // For numbers, booleans, etc., return as-is
  return obj;
}

/**
 * Check if a JSON object is too large and get preview information
 */
export function analyzeJSON(data: any): LargeJSONInfo {
  const full = JSON.stringify(data, null, 2);
  // Use TextEncoder for accurate byte size calculation
  const size = new TextEncoder().encode(full).length;
  const isLarge = size > LARGE_JSON_THRESHOLD;

  // Get preview by truncating property values instead of the entire JSON
  let preview: string;
  if (isLarge) {
    const truncatedData = truncatePropertyValues(data, MAX_VALUE_LENGTH);
    preview = JSON.stringify(truncatedData, null, 2);
  } else {
    preview = full;
  }

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
    // Blob is available in browser environments
    const BlobConstructor = (globalThis as any).Blob as any;
    const blob = new BlobConstructor([jsonString], {
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
