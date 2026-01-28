import type { MessageAttachment } from "./types";

// Hash function to match BrowserOAuthClientProvider
export function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

// File size limits
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file
const MAX_TOTAL_SIZE = 20 * 1024 * 1024; // 20MB total

// Supported image MIME types
const SUPPORTED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
];

/**
 * Validates if a file is an acceptable image type
 */
export function isValidImageType(file: File): boolean {
  return SUPPORTED_IMAGE_TYPES.includes(file.type);
}

/**
 * Validates if a file is within size limits
 */
export function isValidFileSize(file: File): boolean {
  return file.size <= MAX_FILE_SIZE;
}

/**
 * Validates total size of attachments
 */
export function isValidTotalSize(attachments: MessageAttachment[]): boolean {
  const totalSize = attachments.reduce((sum, att) => sum + (att.size || 0), 0);
  return totalSize <= MAX_TOTAL_SIZE;
}

/**
 * Reads a file and converts it to base64
 */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = reader.result as string;
      // Extract base64 data (remove data URL prefix if present)
      const base64Data = result.includes(",") ? result.split(",")[1] : result;
      resolve(base64Data);
    };

    reader.onerror = () => {
      reject(new Error(`Failed to read file: ${file.name}`));
    };

    reader.readAsDataURL(file);
  });
}

/**
 * Converts a File to a MessageAttachment
 */
export async function fileToAttachment(file: File): Promise<MessageAttachment> {
  if (!isValidImageType(file)) {
    throw new Error(
      `Unsupported file type: ${file.type}. Only images are supported.`
    );
  }

  if (!isValidFileSize(file)) {
    throw new Error(`File too large: ${file.name}. Maximum size is 10MB.`);
  }

  const base64Data = await readFileAsBase64(file);

  return {
    type: "image",
    data: base64Data,
    mimeType: file.type,
    name: file.name,
    size: file.size,
  };
}

/**
 * Formats file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
