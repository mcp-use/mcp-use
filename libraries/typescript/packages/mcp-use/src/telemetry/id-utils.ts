/**
 * Inline UUID generation to avoid importing server utils
 */
export function generateUUID(): string {
  // Browser
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  // Node.js fallback (if crypto available in scope)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeCrypto = require("crypto");
    return nodeCrypto.randomUUID();
  } catch {
    // Math.random fallback (should rarely be needed)
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}

/**
 * Generate a cryptographically secure random string for session/user IDs, cross-platform.
 */
export function secureRandomString(): string {
  // Browser
  if (
    typeof window !== "undefined" &&
    window.crypto &&
    typeof window.crypto.getRandomValues === "function"
  ) {
    // 8 random bytes, 16 hex characters
    const array = new Uint8Array(8);
    window.crypto.getRandomValues(array);
    return Array.from(array, (v) => v.toString(16).padStart(2, "0")).join("");
  }
  // Node.js fallback
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const crypto = require("crypto");
    return crypto.randomBytes(8).toString("hex");
  } catch (e) {
    // Fall through to Math.random fallback
  }
  // As absolute last fallback (should never happen), use Math.random (rare/broken case)
  return Math.random().toString(36).substring(2, 15);
}
